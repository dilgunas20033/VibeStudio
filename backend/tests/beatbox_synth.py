"""Synthetic "beatboxing" with known hits, for testing drum transcription.

Mouth percussion is imitated with the acoustic traits that matter for classification:
- kick ("b", "boom"): low thump, pitch drops fast, mostly below 200 Hz, with a short click
- snare ("k", "pf", "psh"): noise burst centred around 1.5-5 kHz plus a little body
- hi-hat ("t", "ts"): short, very bright noise above 6 kHz
- open hat ("tsss"): the same, held for a quarter of a second
"""

import io

import numpy as np
import soundfile as sf

# (class, beat). A basic boom-bap groove over two bars of 4/4.
BOOM_BAP = [
    ("kick", 0), ("hihat", 0.5), ("snare", 1), ("hihat", 1.5),
    ("kick", 2), ("kick", 2.5), ("snare", 3), ("hihat", 3.5),
    ("kick", 4), ("hihat", 4.5), ("snare", 5), ("hihat", 5.5),
    ("kick", 6), ("hihat", 6.5), ("snare", 7), ("openhat", 7.5),
]  # fmt: skip


def _bandpass_noise(rng, n, sr, lo, hi):
    spec = np.fft.rfft(rng.normal(0, 1, n))
    f = np.fft.rfftfreq(n, 1 / sr)
    spec[(f < lo) | (f > hi)] = 0
    y = np.fft.irfft(spec, n)
    return y / (np.max(np.abs(y)) + 1e-9)


def _hit(kind: str, sr: int, rng) -> np.ndarray:
    if kind == "kick":
        n = int(0.22 * sr)
        t = np.arange(n) / sr
        freq = 55 + 110 * np.exp(-t / 0.025)
        y = np.sin(2 * np.pi * np.cumsum(freq) / sr) * np.exp(-t / 0.06)
        click = _bandpass_noise(rng, n, sr, 300, 2000) * np.exp(-t / 0.004) * 0.25
        return y + click
    if kind == "snare":
        n = int(0.18 * sr)
        t = np.arange(n) / sr
        noise = _bandpass_noise(rng, n, sr, 1200, 6000) * np.exp(-t / 0.05)
        body = np.sin(2 * np.pi * 220 * t) * np.exp(-t / 0.02) * 0.4
        return noise + body
    if kind in ("hihat", "openhat"):
        dur, decay = (0.07, 0.015) if kind == "hihat" else (0.32, 0.12)
        n = int(dur * sr)
        t = np.arange(n) / sr
        return (
            _bandpass_noise(rng, n, sr, 6500, min(14000, sr / 2 - 100)) * np.exp(-t / decay) * 0.6
        )
    raise ValueError(kind)


def beatbox(
    hits: list[tuple[str, float]] = BOOM_BAP,
    bpm: float = 90.0,
    sr: int = 22_050,
    lead_in: float = 0.4,
    noise_db: float = -40.0,
    jitter_s: float = 0.012,
    seed: int = 0,
) -> tuple[np.ndarray, int]:
    rng = np.random.default_rng(seed)
    beat = 60 / bpm
    total = lead_in + (max(b for _, b in hits) + 1.5) * beat
    y = np.zeros(int(total * sr))
    for kind, b in hits:
        start = int((lead_in + b * beat + rng.normal(0, jitter_s)) * sr)
        h = _hit(kind, sr, rng) * rng.uniform(0.75, 1.0)
        end = min(len(y), start + len(h))
        y[start:end] += h[: end - start]
    y += rng.normal(0, 10 ** (noise_db / 20), len(y))
    return (0.7 * y / np.max(np.abs(y))).astype(np.float32), sr


def beatbox_wav(**kw) -> bytes:
    y, sr = beatbox(**kw)
    buf = io.BytesIO()
    sf.write(buf, y, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()
