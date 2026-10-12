"""Melody transcription on synthetic humming where the true notes are known."""

import numpy as np
import pytest

from app.transcription.analysis import estimate_key, estimate_tempo
from app.transcription.melody import transcribe_melody
from tests.hum_synth import TWINKLE, expected_onsets, hum

EXPECTED = [p for p, _, _ in TWINKLE]


def accuracy(got: list[int], expected: list[int]) -> float:
    """Fraction of expected notes matched in order (longest common subsequence)."""
    m, n = len(got), len(expected)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m):
        for j in range(n):
            dp[i + 1][j + 1] = (
                dp[i][j] + 1 if got[i] == expected[j] else max(dp[i][j + 1], dp[i + 1][j])
            )
    return dp[m][n] / max(m, n)


def test_clean_hum_is_transcribed_exactly():
    y, sr = hum()
    t = transcribe_melody(y, sr)
    assert [n.pitch for n in t.notes] == EXPECTED
    onsets = expected_onsets()
    assert max(abs(n.start - o) for n, o in zip(t.notes, onsets, strict=True)) < 0.08
    assert all(n.confidence > 0.7 for n in t.notes)
    assert abs(t.tuning_cents - 30) < 8  # the synthetic hum is 30 cents sharp
    assert (t.key.root, t.key.mode) == ("C", "major") and t.key.confidence > 0.5
    assert t.tempo.bpm == pytest.approx(100, rel=0.02)
    assert len(t.curve_times) == len(t.curve_midi) > 100
    assert t.warnings == []


@pytest.mark.parametrize("bpm", [70, 90, 120, 140])
@pytest.mark.parametrize("gap", [0.03, 0.25])
def test_robust_across_tempo_articulation_noise_and_detune(bpm, gap):
    y, sr = hum(
        bpm=bpm, gap_beats=gap, detune_cents=-35 if bpm % 20 else 35, noise_db=-28, seed=bpm
    )
    t = transcribe_melody(y, sr)
    assert accuracy([n.pitch for n in t.notes], EXPECTED) >= 0.9
    # Tempo is right, or off by exactly double/half (inherently ambiguous); the
    # alternative is then offered.
    ratio = t.tempo.bpm / bpm
    assert min(abs(ratio - r) for r in (0.5, 1, 2)) < 0.03
    if abs(ratio - 1) > 0.03:
        assert any(abs(a / bpm - 1) < 0.03 for a in t.tempo.alternatives)


def test_octave_glitch_is_repaired():
    y, sr = hum(octave_glitch_at=4)  # the 5th note is hummed an octave up
    t = transcribe_melody(y, sr)
    assert [n.pitch for n in t.notes] == EXPECTED


def test_silence_and_noise_give_no_confident_notes():
    sr = 22_050
    t = transcribe_melody(np.zeros(sr * 2, dtype=np.float32), sr)
    assert t.notes == [] and "silent" in t.warnings[0]
    noise = np.random.default_rng(0).normal(0, 0.3, sr * 3).astype(np.float32)
    t = transcribe_melody(noise, sr)
    assert len(t.notes) <= 2 and all(n.confidence < 0.6 for n in t.notes)


def test_other_sample_rates_are_resampled():
    y, sr = hum(sr=44_100)
    assert [n.pitch for n in transcribe_melody(y, sr).notes] == EXPECTED


def test_tempo_and_key_helpers():
    assert estimate_tempo([0.0, 0.5]).confidence == 0.0  # too few notes
    t = estimate_tempo([i * 0.5 for i in range(12)])  # steady quarter notes at 120
    assert t.bpm in (pytest.approx(120, rel=0.01), pytest.approx(60, rel=0.01))
    a_minor = estimate_key([57, 60, 64, 69, 72, 71, 69, 64], [2, 1, 1, 2, 1, 1, 2, 1])
    assert (a_minor.root, a_minor.mode) == ("A", "minor")
    assert estimate_key([60, 60, 60], [1, 1, 1]).confidence < 0.5  # one pitch class
