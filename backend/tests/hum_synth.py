"""Synthetic "humming" with known notes, for testing transcription.

Imitates a human hum: harmonic-rich tone, vibrato, short glides between notes, attack and
release, small gaps, background noise and an overall detune.
"""

import io

import numpy as np
import soundfile as sf

# (MIDI pitch, start beat, length in beats)
TWINKLE = [
    (60, 0, 1), (60, 1, 1), (67, 2, 1), (67, 3, 1), (69, 4, 1), (69, 5, 1), (67, 6, 2),
    (65, 8, 1), (65, 9, 1), (64, 10, 1), (64, 11, 1), (62, 12, 1), (62, 13, 1), (60, 14, 2),
]  # fmt: skip


def hum(
    notes: list[tuple[int, float, float]] = TWINKLE,
    bpm: float = 100.0,
    sr: int = 22_050,
    detune_cents: float = 30.0,
    noise_db: float = -35.0,
    gap_beats: float = 0.12,
    lead_in: float = 0.3,
    seed: int = 0,
    octave_glitch_at: int | None = None,
) -> tuple[np.ndarray, int]:
    rng = np.random.default_rng(seed)
    beat = 60.0 / bpm
    total = lead_in + max(s + d for _, s, d in notes) * beat + 0.5
    t = np.arange(int(total * sr)) / sr
    f = np.zeros_like(t)
    amp = np.zeros_like(t)
    prev = None
    for k, (pitch, start, length) in enumerate(notes):
        a = int((lead_in + start * beat) * sr)
        b = int((lead_in + (start + length - gap_beats) * beat) * sr)
        seg = t[a:b] - t[a]
        target = 440.0 * 2 ** ((pitch - 69 + detune_cents / 100) / 12)
        if octave_glitch_at == k:
            target *= 2  # pitch trackers sometimes jump an octave; so do real voices
        freq = np.full_like(seg, target)
        if prev is not None:  # 30 ms glide in from the previous note
            glide = seg < 0.03
            freq[glide] = prev + (target - prev) * (seg[glide] / 0.03)
        freq *= 2 ** ((0.2 * np.sin(2 * np.pi * 5.5 * seg + rng.uniform(0, 6))) / 12)  # vibrato
        env = np.minimum(1, seg / 0.02) * np.minimum(1, (seg[-1] - seg) / 0.03 + 1e-9)
        f[a:b] = freq
        amp[a:b] = env * rng.uniform(0.7, 1.0)
        prev = target
    phase = 2 * np.pi * np.cumsum(f) / sr
    y = amp * (np.sin(phase) + 0.5 * np.sin(2 * phase) + 0.25 * np.sin(3 * phase))
    y += rng.normal(0, 10 ** (noise_db / 20), len(y))
    y = 0.6 * y / np.max(np.abs(y))
    return y.astype(np.float32), sr


def hum_wav(**kw) -> bytes:
    y, sr = hum(**kw)
    buf = io.BytesIO()
    sf.write(buf, y, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def expected_onsets(notes=TWINKLE, bpm=100.0, lead_in=0.3) -> list[float]:
    return [lead_in + s * 60 / bpm for _, s, _ in notes]
