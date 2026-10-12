"""Monophonic melody transcription: audio -> notes with timing and confidence.

Pipeline:
1. Mono, resample to 22.05 kHz, peak-normalise.
2. pYIN pitch tracking (C2-C6) with voicing probabilities.
3. Voicing gate using pYIN probability and a relative energy floor.
4. Global tuning offset (hummers are often consistently sharp or flat).
5. Octave-error repair: frames an octave away from their local median are folded back.
6. Segmentation: a note ends at a voicing gap, at a stable pitch change, or at an
   articulation onset (e.g. "da da da" on one pitch).
7. Per-note pitch (median), confidence (voicing probability x pitch stability), velocity.
8. Tempo and key estimates from the notes.
"""

import io
import logging
from dataclasses import dataclass

import librosa
import numpy as np
import soundfile as sf
from scipy.ndimage import median_filter

from app.transcription.analysis import KeyEstimate, TempoEstimate, estimate_key, estimate_tempo

log = logging.getLogger(__name__)

SR = 22_050
HOP = 256  # ~11.6 ms frames
FRAME = 2048
FMIN = librosa.note_to_hz("C2")
FMAX = librosa.note_to_hz("C6")
MIN_NOTE_S = 0.07
GAP_FRAMES = 3  # unvoiced frames that end a note (~35 ms)
CHANGE_FRAMES = 4  # frames a new pitch must hold to split a note (~46 ms)
CHANGE_SEMITONES = 0.75
MAX_SECONDS = 120.0
CURVE_POINTS = 2000


@dataclass(frozen=True)
class DetectedNote:
    start: float  # seconds
    end: float
    pitch: int  # MIDI
    pitch_cents: float  # deviation of the sung pitch from `pitch`, after tuning correction
    confidence: float  # 0..1
    velocity: int


@dataclass(frozen=True)
class MelodyTranscription:
    notes: list[DetectedNote]
    duration: float
    tuning_cents: float
    tempo: TempoEstimate
    key: KeyEstimate
    curve_times: list[float]  # voiced pitch curve for display (seconds)
    curve_midi: list[float]
    warnings: list[str]


def load_audio(data: bytes) -> tuple[np.ndarray, int]:
    y, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    return y.mean(axis=1), sr


def transcribe_melody(y: np.ndarray, sr: int) -> MelodyTranscription:
    warnings: list[str] = []
    if len(y) / sr > MAX_SECONDS:
        y = y[: int(MAX_SECONDS * sr)]
        warnings.append(f"Only the first {MAX_SECONDS:g} seconds were transcribed.")
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    duration = len(y) / SR
    peak = float(np.max(np.abs(y))) if len(y) else 0.0
    empty = MelodyTranscription(
        [], duration, 0.0, estimate_tempo([]), estimate_key([], []), [], [], []
    )
    if peak < 1e-3:
        return MelodyTranscription(**{**empty.__dict__, "warnings": ["The recording is silent."]})
    y = y / peak

    f0, voiced_flag, voiced_prob = librosa.pyin(
        y, fmin=FMIN, fmax=FMAX, sr=SR, frame_length=FRAME, hop_length=HOP
    )
    rms = librosa.feature.rms(y=y, frame_length=FRAME, hop_length=HOP)[0]
    n = min(len(f0), len(rms))
    f0, voiced_flag, voiced_prob, rms = f0[:n], voiced_flag[:n], voiced_prob[:n], rms[:n]
    times = librosa.frames_to_time(np.arange(n), sr=SR, hop_length=HOP)

    energy_floor = max(0.02 * float(np.percentile(rms, 95)), 1e-4)
    voiced = voiced_flag & (voiced_prob > 0.25) & (rms > energy_floor) & ~np.isnan(f0)
    if voiced.sum() < 5:
        return MelodyTranscription(
            **{
                **empty.__dict__,
                "warnings": ["No clear pitch was found. Try humming louder or closer."],
            }
        )
    midi = np.full(n, np.nan)
    midi[voiced] = librosa.hz_to_midi(f0[voiced])

    # Tuning: circular mean of the fractional semitone, weighted by voicing confidence.
    frac = midi[voiced] - np.round(midi[voiced])
    angle = np.angle(np.sum(voiced_prob[voiced] * np.exp(2j * np.pi * frac)))
    tuning = float(angle / (2 * np.pi))  # semitones, -0.5..0.5
    midi[voiced] -= tuning

    midi = _repair_octaves(midi, voiced)
    midi[voiced] = median_filter(midi[voiced], size=5, mode="nearest")

    onset_frames = set(
        librosa.onset.onset_detect(y=y, sr=SR, hop_length=HOP, backtrack=False, units="frames")
    )
    # A short window (23 ms) sees the brief level dips between legato syllables that the
    # 93 ms analysis window smooths away.
    rms_short = librosa.feature.rms(y=y, frame_length=512, hop_length=HOP)[0][:n]
    segments = _segment(midi, voiced, onset_frames, rms_short)

    notes: list[DetectedNote] = []
    loud = float(np.percentile(rms[voiced], 90)) or 1.0
    loud_short = float(np.percentile(rms_short[voiced], 90)) or 1.0
    for a, b in segments:
        start, end = float(times[a]), float(times[b - 1] + HOP / SR)
        if end - start < MIN_NOTE_S:
            continue
        if float(np.mean(rms_short[a:b])) < 0.3 * loud_short:
            continue  # mostly the quiet gap between notes, smeared by the long pitch frames
        seg = midi[a:b][voiced[a:b]]
        if len(seg) < 3:
            continue
        pitch_f = float(np.median(seg))
        pitch = int(round(pitch_f))
        stability = float(np.clip(1.0 - (np.std(seg) - 0.2) / 1.0, 0.25, 1.0))
        conf = float(np.mean(voiced_prob[a:b][voiced[a:b]])) * stability
        level = float(np.mean(rms[a:b])) / loud
        notes.append(
            DetectedNote(
                start=round(start, 4),
                end=round(end, 4),
                pitch=int(np.clip(pitch, 0, 127)),
                pitch_cents=round((pitch_f - pitch) * 100, 1),
                confidence=round(float(np.clip(conf, 0, 1)), 3),
                velocity=int(np.clip(60 + 60 * level, 40, 120)),
            )
        )

    notes = _fix_isolated_octave_jumps(notes)
    if not notes:
        warnings.append("No notes long enough to keep were found.")
    elif sum(n.confidence < 0.5 for n in notes) > len(notes) / 2:
        warnings.append("Many notes are uncertain. Hum each note clearly, with short gaps.")

    tempo = estimate_tempo([n.start for n in notes])
    key = estimate_key([n.pitch for n in notes], [(n.end - n.start) * n.confidence for n in notes])

    idx = np.flatnonzero(voiced)
    step = max(1, len(idx) // CURVE_POINTS)
    idx = idx[::step]
    log.info(
        "transcribed %.1fs: %d notes, tuning %+.0f cents, tempo %.1f (conf %.2f), key %s %s",
        duration, len(notes), tuning * 100, tempo.bpm, tempo.confidence, key.root, key.mode,
    )  # fmt: skip
    return MelodyTranscription(
        notes=notes,
        duration=round(duration, 3),
        tuning_cents=round(tuning * 100, 1),
        tempo=tempo,
        key=key,
        curve_times=[round(float(times[i]), 3) for i in idx],
        curve_midi=[round(float(midi[i]), 2) for i in idx],
        warnings=warnings,
    )


def _repair_octaves(midi: np.ndarray, voiced: np.ndarray) -> np.ndarray:
    """Fold frames that sit an octave above/below the local median back into place."""
    out = midi.copy()
    vals = out[voiced]
    if len(vals) < 9:
        return out
    local = median_filter(vals, size=21, mode="nearest")
    diff = vals - local
    vals = np.where(np.abs(diff - 12) < 1.5, vals - 12, vals)
    vals = np.where(np.abs(diff + 12) < 1.5, vals + 12, vals)
    out[voiced] = vals
    return out


def _segment(
    midi: np.ndarray, voiced: np.ndarray, onsets: set[int], rms: np.ndarray
) -> list[tuple[int, int]]:
    """Split voiced frames into note segments [start, end)."""
    segments: list[tuple[int, int]] = []
    n = len(midi)
    i = 0
    while i < n:
        if not voiced[i]:
            i += 1
            continue
        start = i
        ref: list[float] = [midi[i]]
        gap = 0
        j = i + 1
        while j < n:
            if not voiced[j]:
                gap += 1
                if gap >= GAP_FRAMES:
                    break
                j += 1
                continue
            gap = 0
            centre = float(np.median(ref[-15:]))
            if abs(midi[j] - centre) > CHANGE_SEMITONES:
                ahead = midi[j : j + CHANGE_FRAMES]
                if (
                    len(ahead) == CHANGE_FRAMES
                    and np.all(voiced[j : j + CHANGE_FRAMES])
                    and np.all(np.abs(ahead - centre) > CHANGE_SEMITONES)
                ):
                    break  # a new, stable pitch: start a new note here
            elif (j - start) * HOP / SR > 0.1 and (
                (j in onsets and _dips(rms, start, j)) or _valley(rms, start, j)
            ):
                break  # re-articulated note on the same pitch
            ref.append(midi[j])
            j += 1
        end = j - gap if gap else j
        segments.append((start, max(end, start + 1)))
        i = j
    return segments


def _dips(rms: np.ndarray, start: int, j: int) -> bool:
    """True when the level just before frame j fell well below the note's peak so far.
    Separates real re-articulations from vibrato and breath noise."""
    peak = float(np.max(rms[start:j]))
    trough = float(np.min(rms[max(start, j - 4) : j + 1]))
    return trough < 0.6 * peak


def _valley(rms: np.ndarray, start: int, j: int) -> bool:
    """A clear loudness valley at j (e.g. legato "da-da" with almost no gap)."""
    if j + 6 >= len(rms) or j < 1:
        return False
    v = rms[j]
    peak = float(np.max(rms[start:j]))
    is_min = v <= rms[j - 1] and v <= rms[j + 1]
    return bool(is_min and v < 0.45 * peak and np.max(rms[j + 1 : j + 6]) > 1.6 * v)


def _fix_isolated_octave_jumps(notes: list[DetectedNote]) -> list[DetectedNote]:
    """A single note an octave away from both neighbours is almost always a pitch-tracking
    octave error; move it next to its neighbours."""
    if len(notes) < 3:
        return notes
    fixed = list(notes)
    for k in range(1, len(fixed) - 1):
        prev, cur, nxt = fixed[k - 1].pitch, fixed[k].pitch, fixed[k + 1].pitch
        for shift in (-12, 12):
            moved = cur + shift
            if (
                abs(moved - prev) <= 7
                and abs(moved - nxt) <= 7
                and abs(cur - prev) >= 9
                and abs(cur - nxt) >= 9
            ):
                fixed[k] = DetectedNote(**{**fixed[k].__dict__, "pitch": moved})
                break
    return fixed
