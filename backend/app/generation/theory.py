"""Small music-theory toolkit: scales, diatonic chords, progressions, voicing."""

from dataclasses import dataclass

from app.schemas.project import MusicalKey

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
SCALES = {"major": (0, 2, 4, 5, 7, 9, 11), "minor": (0, 2, 3, 5, 7, 8, 10)}

# Progressions as 0-based scale degrees, one chord per bar, four bars. Chosen per mood
# from common practice in each style (e.g. i-VI-III-VII is the classic minor trap loop).
PROGRESSIONS: dict[str, list[tuple[int, ...]]] = {
    "dark": [(0, 5, 2, 6), (0, 3, 5, 4), (0, 5, 3, 4), (0, 0, 5, 6)],
    "emotional": [(0, 5, 2, 6), (5, 6, 0, 0), (0, 3, 5, 6), (0, 6, 5, 6)],
    "aggressive": [(0, 0, 5, 4), (0, 1, 0, 6), (0, 5, 0, 6)],
    "uplifting": [(0, 4, 5, 3), (0, 3, 5, 4), (3, 4, 0, 5), (0, 5, 3, 4)],
    "chill": [(1, 4, 0, 0), (3, 2, 1, 0), (0, 5, 1, 4), (3, 4, 2, 5)],
    "dreamy": [(0, 2, 3, 3), (3, 0, 5, 4), (0, 5, 3, 0), (5, 3, 0, 4)],
}


def key_pc(key: MusicalKey) -> int:
    return NOTE_NAMES.index(key.root)


def degree_to_pitch(key: MusicalKey, degree: int, octave: int) -> int:
    """MIDI pitch of a scale degree (any integer, wraps across octaves). Octave 4 = C4 (60)."""
    scale = SCALES[key.mode]
    octave_shift, idx = divmod(degree, 7)
    return 12 * (octave + 1 + octave_shift) + key_pc(key) + scale[idx]


def pitch_in_key(pitch: int, key: MusicalKey) -> bool:
    return (pitch - key_pc(key)) % 12 in SCALES[key.mode]


@dataclass(frozen=True)
class Chord:
    degree: int
    """Scale degree of the root (0-6)."""
    tones: tuple[int, ...]
    """Scale degrees of the chord tones (root, third, fifth[, seventh])."""

    @property
    def pitch_classes(self) -> set[int]:
        return {t % 7 for t in self.tones}


def diatonic_chord(degree: int, sevenths: bool) -> Chord:
    tones = (degree, degree + 2, degree + 4) + ((degree + 6,) if sevenths else ())
    return Chord(degree=degree % 7, tones=tones)


def voice_chords(
    key: MusicalKey, chords: list[Chord], low: int = 52, high: int = 76
) -> list[list[int]]:
    """Pick an inversion for each chord that stays in range and moves as little as possible
    from the previous chord (simple voice leading)."""
    voiced: list[list[int]] = []
    prev: list[int] | None = None
    for chord in chords:
        candidates: list[list[int]] = []
        for octave in (2, 3, 4, 5):
            base = [degree_to_pitch(key, t, octave) for t in chord.tones]
            for inv in range(len(base)):
                notes = sorted(base[inv:] + [p + 12 for p in base[:inv]])
                if notes[0] >= low and notes[-1] <= high:
                    candidates.append(notes)
        if not candidates:  # range too narrow for this chord; fall back to root position
            candidates = [[degree_to_pitch(key, t, 3) for t in chord.tones]]
        if prev is None:
            middle = (low + high) / 2
            best = min(candidates, key=lambda n: abs(sum(n) / len(n) - middle))
        else:
            centre = sum(prev) / len(prev)
            best = min(candidates, key=lambda n: abs(sum(n) / len(n) - centre))
        voiced.append(best)
        prev = best
    return voiced
