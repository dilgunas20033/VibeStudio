"""Beatbox (vocal percussion) transcription: audio -> classified drum hits.

Signal processing, not a trained classifier:
1. Onset detection (spectral flux) with backtracking to the attack, and a level gate.
2. Per-hit features over the first ~80 ms: low/mid/high band energy ratios, spectral
   centroid, spectral flatness (noise vs tone) and decay time.
3. Rule scores per class (kick, snare, hihat, openhat, perc) from those features.
4. Consistency: hits are clustered by their features and each cluster takes the class
   most of its hits voted for, so the same mouth sound gets the same drum throughout.
5. Confidence per hit = how clearly its own scores and its cluster agree.

Beatboxers make very different sounds, so labels are a starting point and the UI makes
reclassifying easy.
"""

import logging
from dataclasses import dataclass

import librosa
import numpy as np
from scipy.cluster.vq import kmeans2

from app.transcription.analysis import TempoEstimate, estimate_tempo

log = logging.getLogger(__name__)

SR = 22_050
HOP = 128  # ~5.8 ms: drum onsets need finer timing than melody
N_FFT = 1024
FEATURE_S = 0.08
MAX_SECONDS = 120.0
CLASSES = ("kick", "snare", "hihat", "openhat", "perc")
CLEAR_MARGIN = 0.35  # score margin above which a hit's own label is trusted over its cluster
OPEN_HAT_DECAY_S = 0.075  # time to fall 10 dB: closed hats ~20 ms, open hats 100 ms+


@dataclass(frozen=True)
class DrumHit:
    time: float  # seconds
    drum: str  # one of CLASSES
    confidence: float  # 0..1
    velocity: int
    centroid_hz: float
    low_ratio: float
    high_ratio: float
    decay_s: float


@dataclass(frozen=True)
class BeatboxTranscription:
    hits: list[DrumHit]
    duration: float
    tempo: TempoEstimate
    warnings: list[str]


def _features(y: np.ndarray, onset: int, end: int, floor: float = 0.0) -> dict[str, float] | None:
    seg = y[onset : min(end, onset + int(FEATURE_S * SR))]
    if len(seg) < 256:
        return None
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
    freqs = np.fft.rfftfreq(len(seg), 1 / SR)
    total = float(spec.sum()) + 1e-12
    low = float(spec[freqs < 250].sum()) / total
    mid = float(spec[(freqs >= 250) & (freqs < 5000)].sum()) / total
    high = float(spec[freqs >= 5000].sum()) / total
    centroid = float((freqs * spec).sum() / total)
    flatness = float(np.exp(np.mean(np.log(spec + 1e-12))) / (np.mean(spec) + 1e-12))

    # Decay: time from the peak until the level falls 20 dB below it (within the hit window).
    win = y[onset : min(end, onset + int(0.5 * SR))]
    frame = 128
    env = np.sqrt(np.convolve(win**2, np.ones(frame) / frame, mode="valid")[::32] + 1e-12)
    if len(env) == 0:
        return None
    # The hit's own peak is right after its onset; later peaks belong to the next sound.
    peak_i = int(np.argmax(env[: max(1, int(0.03 * SR / 32))]))
    # Decay ends 10 dB below the peak (robust to room noise), or at the noise if sooner.
    below = np.flatnonzero(env[peak_i:] < max(env[peak_i] * 0.3, floor * 1.5))
    decay = (below[0] if len(below) else len(env) - peak_i) * 32 / SR
    return {
        "low": low,
        "mid": mid,
        "high": high,
        "centroid": centroid,
        "flatness": flatness,
        "decay": float(decay),
        "level": float(env[peak_i]),
    }


def _refine_onset(y: np.ndarray, onset: int) -> int:
    """Move an onset to just before the steepest level rise within -40/+25 ms. Spectral-flux
    onsets can land late, and short sounds like hi-hats decay within ~20 ms."""
    lo, hi = max(0, onset - int(0.04 * SR)), min(len(y), onset + int(0.025 * SR))
    seg = y[lo:hi]
    if len(seg) < 128:
        return onset
    env = np.sqrt(np.convolve(seg**2, np.ones(64) / 64, mode="same") + 1e-12)
    rise = np.diff(env)
    return int(lo + max(0, int(np.argmax(rise)) - 32))


def _scores(f: dict[str, float]) -> dict[str, float]:
    """Heuristic class scores (higher = more likely), roughly 0..1."""
    c = np.log2(max(f["centroid"], 50.0))  # 50 Hz -> 5.6, 8 kHz -> 13
    kick = 1.6 * f["low"] + max(0.0, (10.0 - c) / 4)
    hat = 1.4 * f["high"] + max(0.0, (c - 11.5) / 2) - 1.2 * f["low"]
    snare = (
        1.2 * f["mid"] + 0.6 * f["flatness"] + (0.5 if 10 <= c <= 12.5 else 0.0) - 0.8 * f["low"]
    )
    perc = 0.9 * f["mid"] + 0.6 * (1 - f["flatness"]) - 0.5 * f["low"] - 0.3 * f["high"]
    scores = {"kick": kick, "snare": snare, "hihat": hat, "perc": perc * 0.8}
    # A long, bright hit is an open hat.
    scores["openhat"] = hat + (0.6 if f["decay"] > OPEN_HAT_DECAY_S else -0.6)
    if f["decay"] > OPEN_HAT_DECAY_S:
        scores["hihat"] -= 0.4
    return scores


def transcribe_beatbox(y: np.ndarray, sr: int) -> BeatboxTranscription:
    warnings: list[str] = []
    if len(y) / sr > MAX_SECONDS:
        y = y[: int(MAX_SECONDS * sr)]
        warnings.append(f"Only the first {MAX_SECONDS:g} seconds were transcribed.")
    if sr != SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    duration = len(y) / SR
    peak = float(np.max(np.abs(y))) if len(y) else 0.0
    if peak < 1e-3:
        return BeatboxTranscription([], duration, estimate_tempo([]), ["The recording is silent."])
    y = y / peak

    # Spectral flux on a dB spectrogram with linear frequency bins: bright, quiet sounds
    # (hi-hats) count as much as loud low ones (kicks). A mel view under-weights them.
    spec_db = librosa.amplitude_to_db(
        np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP)), ref=np.max
    )
    env = librosa.onset.onset_strength(S=spec_db, sr=SR, hop_length=HOP, lag=2)
    env = env / (np.max(env) + 1e-9)
    onsets = librosa.onset.onset_detect(
        onset_envelope=env, sr=SR, hop_length=HOP, backtrack=True, units="samples",
        pre_max=3, post_max=3, pre_avg=12, post_avg=12, delta=0.07, wait=10,
    )  # fmt: skip
    onsets = sorted({_refine_onset(y, int(o)) for o in onsets})
    floor = float(np.percentile(librosa.feature.rms(y=y, frame_length=512, hop_length=256)[0], 10))
    feats: list[tuple[int, dict[str, float]]] = []
    bounds = list(onsets) + [len(y)]
    for k, o in enumerate(onsets):
        if o < 0.06 * SR:
            continue  # the recording starting is not a hit
        f = _features(y, o, bounds[k + 1], floor)
        if f is not None:
            feats.append((o, f))
    # Level gate against the room's noise floor (not the loudest hit: hi-hats are
    # legitimately much quieter than kicks).
    feats = [(o, f) for o, f in feats if f["level"] > max(2.5 * floor, 0.008)]
    if not feats:
        return BeatboxTranscription([], duration, estimate_tempo([]), ["No hits were found."])
    loud = float(np.percentile([f["level"] for _, f in feats], 90))

    raw = [_scores(f) for _, f in feats]
    labels = [max(s, key=s.__getitem__) for s in raw]
    margins = [
        sorted(s.values(), reverse=True)[0] - sorted(s.values(), reverse=True)[1] for s in raw
    ]
    labels = _cluster_vote(feats, labels, margins)

    hits: list[DrumHit] = []
    for (o, f), s, label in zip(feats, raw, labels, strict=True):
        ordered = sorted(s.values(), reverse=True)
        margin = ordered[0] - ordered[1]
        own_best = max(s, key=s.__getitem__)
        conf = float(np.clip(0.45 + margin, 0.05, 1.0)) * (1.0 if own_best == label else 0.6)
        hits.append(
            DrumHit(
                time=round(o / SR, 4),
                drum=label,
                confidence=round(conf, 3),
                velocity=int(np.clip(50 + 75 * f["level"] / loud, 30, 127)),
                centroid_hz=round(f["centroid"], 1),
                low_ratio=round(f["low"], 3),
                high_ratio=round(f["high"], 3),
                decay_s=round(f["decay"], 3),
            )
        )

    if len(hits) < 3:
        warnings.append("Only a few hits were found. Beatbox louder, or closer to the mic.")
    tempo = estimate_tempo([h.time for h in hits])
    log.info(
        "beatbox %.1fs: %d hits %s, tempo %.1f",
        duration, len(hits), {c: labels.count(c) for c in CLASSES if c in labels}, tempo.bpm,
    )  # fmt: skip
    return BeatboxTranscription(hits, round(duration, 3), tempo, warnings)


def _cluster_vote(
    feats: list[tuple[int, dict[str, float]]], labels: list[str], margins: list[float]
) -> list[str]:
    """Make similar-sounding hits share a class: cluster on spectral shape and give each
    cluster its majority label. Hits that were clearly one class on their own keep it."""
    n = len(feats)
    if n < 6:
        return labels
    x = np.array(
        [[f["low"], f["high"], np.log2(max(f["centroid"], 50)) / 4, min(f["decay"], 0.4) * 3]
         for _, f in feats]
    )  # fmt: skip
    k = min(5, max(2, n // 4))
    rng = np.random.default_rng(0)
    try:
        _, assign = kmeans2(x, k, minit="++", seed=rng)
    except (ValueError, np.linalg.LinAlgError):  # degenerate data (identical hits, etc.)
        return labels
    out = list(labels)
    for c in range(k):
        members = [i for i in range(n) if assign[i] == c]
        if not members:
            continue
        votes = [labels[i] for i in members]
        winner = max(set(votes), key=votes.count)
        if votes.count(winner) / len(votes) >= 0.6:
            for i in members:
                if margins[i] < CLEAR_MARGIN:
                    out[i] = winner
    return out
