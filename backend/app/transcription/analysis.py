"""Tempo and key estimation from transcribed notes."""

import math
from dataclasses import dataclass

import numpy as np

from app.generation.theory import NOTE_NAMES

# Krumhansl-Kessler key profiles (major, minor), tonic first.
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


TIMING_TOLERANCE_S = 0.04


@dataclass(frozen=True)
class TempoEstimate:
    bpm: float
    confidence: float
    alternatives: tuple[float, ...]


@dataclass(frozen=True)
class KeyEstimate:
    root: str
    mode: str
    confidence: float


def estimate_tempo(onsets: list[float], prior_bpm: float = 100.0) -> TempoEstimate:
    """Find the tempo whose eighth-note grid best fits the note onsets.

    Half- and double-time tempos fit a grid equally well, so a broad prior around
    `prior_bpm` breaks the tie and both alternatives are returned for the UI.
    """
    if len(onsets) < 3:
        return TempoEstimate(prior_bpm, 0.0, ())
    t = np.asarray(onsets, dtype=float) - onsets[0]
    candidates = np.arange(60.0, 180.01, 0.25)
    scores = np.empty_like(candidates)
    for i, bpm in enumerate(candidates):
        grid = 60.0 / bpm / 2  # eighth note
        # Timing tolerance is absolute (human timing jitter is ~20-40 ms whatever the
        # tempo), capped so a coarse grid can't swallow every onset.
        tol = min(TIMING_TOLERANCE_S, 0.2 * grid)
        err = np.abs(t - np.round(t / grid) * grid)  # seconds
        fit = np.exp(-((err / tol) ** 2)).mean()
        # Prefer onsets that also land on quarter notes (a coarser, more musical grid).
        beat = grid * 2
        on_beat = np.exp(-((np.abs(t - np.round(t / beat) * beat) / tol) ** 2)).mean()
        prior = math.exp(-0.5 * (math.log2(bpm / prior_bpm) / 0.6) ** 2)
        scores[i] = (0.8 * fit + 0.2 * on_beat) * (0.75 + 0.25 * prior)
    best = int(np.argmax(scores))
    bpm = float(candidates[best])
    # Random onsets average ~0.18 confidence on this scale (max ~0.35 over 30 trials).
    confidence = float(np.clip((scores[best] - 0.45) / 0.45, 0.0, 1.0))
    alts = tuple(b for b in (bpm / 2, bpm * 2) if 60 <= b <= 200)
    return TempoEstimate(round(bpm * 4) / 4, round(confidence, 3), alts)


def estimate_key(pitches: list[int], weights: list[float]) -> KeyEstimate:
    """Krumhansl-Schmuckler key finding on a duration-weighted pitch-class histogram."""
    if not pitches:
        return KeyEstimate("C", "major", 0.0)
    hist = np.zeros(12)
    for p, w in zip(pitches, weights, strict=True):
        hist[p % 12] += w
    results: list[tuple[float, str, str]] = []
    for tonic in range(12):
        for mode, profile in (("major", MAJOR), ("minor", MINOR)):
            r = np.corrcoef(hist, np.roll(profile, tonic))[0, 1]
            results.append((0.0 if np.isnan(r) else float(r), NOTE_NAMES[tonic], mode))
    results.sort(reverse=True)
    best, second = results[0], results[1]
    # Few distinct pitch classes make the estimate unreliable; so does a close runner-up.
    distinct = int((hist > 0).sum())
    confidence = (
        max(0.0, best[0]) * min(1.0, distinct / 5) * min(1.0, 0.4 + 4 * (best[0] - second[0]))
    )
    return KeyEstimate(best[1], best[2], round(float(np.clip(confidence, 0, 1)), 3))
