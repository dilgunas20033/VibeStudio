"""Merge user settings, prompt hints and genre defaults into a GenerationPlan.

Precedence for every field: explicit user setting > prompt hint > genre/mood default.
The plan records which one won (`sources`) so the UI can show how the prompt was read.
"""

import logging
import random
from dataclasses import dataclass

from app.config import get_settings
from app.generation.composer import plan_sections
from app.generation.interpret import interpret_rules
from app.generation.llm import InterpreterUnavailable, interpret_llm
from app.generation.params import (
    MAX_DRUM_BEATS,
    MAX_MELODY_BEATS,
    GenerationPlan,
    GenerationRequest,
    Genre,
    InstrumentName,
    Mood,
    PromptHints,
    Source,
)
from app.schemas.project import MusicalKey
from app.transcription.analysis import estimate_key

log = logging.getLogger(__name__)

DRUM_NAMES = ("kick", "snare", "clap", "hihat", "openhat", "perc")


@dataclass(frozen=True)
class GenreDefaults:
    bpm: tuple[int, int]
    mood: Mood
    instruments: tuple[InstrumentName, ...]
    keys: tuple[str, ...]


GENRE_DEFAULTS: dict[Genre, GenreDefaults] = {
    "trap": GenreDefaults(
        (130, 150), "dark", ("kick", "snare", "clap", "hihat", "openhat", "bass", "lead", "pad"),
        ("A", "C#", "D#", "F", "G"),
    ),
    "drill": GenreDefaults(
        (140, 144), "dark", ("kick", "snare", "hihat", "perc", "bass", "lead", "pad"),
        ("C#", "D#", "F#", "G#", "A#"),
    ),
    "boombap": GenreDefaults(
        (86, 96), "chill", ("kick", "snare", "hihat", "perc", "bass", "keys"),
        ("C", "D", "E", "F", "A"),
    ),
    "lofi": GenreDefaults(
        (70, 88), "chill", ("kick", "snare", "hihat", "bass", "keys", "pad"),
        ("C", "D", "F", "G", "A"),
    ),
    "house": GenreDefaults(
        (120, 126), "uplifting", ("kick", "clap", "hihat", "openhat", "bass", "pluck", "pad"),
        ("A", "C", "F", "G", "D"),
    ),
    "pop": GenreDefaults(
        (100, 118), "uplifting", ("kick", "snare", "clap", "hihat", "bass", "keys", "lead", "pad"),
        ("C", "D", "E", "G", "A"),
    ),
}  # fmt: skip

MOOD_GENRE: dict[Mood, Genre] = {
    "dark": "trap", "emotional": "trap", "aggressive": "drill",
    "uplifting": "pop", "chill": "lofi", "dreamy": "lofi",
}  # fmt: skip
MOOD_MODE: dict[Mood, str] = {
    "dark": "minor", "emotional": "minor", "aggressive": "minor",
    "uplifting": "major", "chill": "major", "dreamy": "major",
}  # fmt: skip
MOOD_ENERGY: dict[Mood, float] = {
    "dark": 0.6, "emotional": 0.5, "aggressive": 0.85,
    "uplifting": 0.7, "chill": 0.35, "dreamy": 0.4,
}  # fmt: skip

# Bars per structure at the reference length; scaled when a duration is requested.
STRUCTURE_BARS = {"loop": 4, "short": 32, "full": 56}


def interpret(request: GenerationRequest) -> tuple[PromptHints, str, str | None, list[str]]:
    """Run the configured interpreter. Returns (hints, interpreter, model, warnings)."""
    warnings: list[str] = []
    want_llm = request.interpreter == "llm" or (
        request.interpreter == "auto" and get_settings().llm_provider == "anthropic"
    )
    if want_llm and request.prompt.strip():
        if get_settings().llm_provider != "anthropic":
            warnings.append(
                "AI interpretation is not configured on this server; used keyword rules."
            )
        else:
            try:
                hints, model = interpret_llm(request.prompt)
                return hints, "llm", model, warnings
            except InterpreterUnavailable as e:
                log.warning("llm interpreter failed, falling back to rules: %s", e)
                warnings.append(f"AI interpretation unavailable ({e}); used keyword rules.")
    return interpret_rules(request.prompt), "rules", None, warnings


def _pick(field: str, user, hint, default, sources: dict[str, Source]):
    if user is not None:
        sources[field] = "user"
        return user
    if hint is not None:
        sources[field] = "prompt"
        return hint
    sources[field] = "default"
    return default


def resolve_plan(request: GenerationRequest) -> GenerationPlan:
    hints, interpreter, model, warnings = interpret(request)
    warnings += hints.notes
    seed = request.seed if request.seed is not None else random.SystemRandom().randrange(2**31)
    rng = random.Random(seed)
    src: dict[str, Source] = {}

    hinted_mood = request.mood or hints.mood
    genre_default: Genre = MOOD_GENRE.get(hinted_mood, "trap") if hinted_mood else "trap"
    genre: Genre = _pick("genre", request.genre, hints.genre, genre_default, src)
    d = GENRE_DEFAULTS[genre]
    mood: Mood = _pick("mood", request.mood, hints.mood, d.mood, src)
    energy = _pick("energy", request.energy, hints.energy, MOOD_ENERGY[mood], src)
    bpm = _pick("bpm", request.bpm, hints.bpm, float(rng.randint(*d.bpm)), src)
    melody = request.melody
    melody_key = None
    if melody is not None:
        # The beat must fit the melody, so its key outranks genre/mood defaults.
        est = estimate_key(
            [n.pitch for n in melody.notes],
            [n.duration_beats * (n.confidence if n.confidence is not None else 1.0)
             for n in melody.notes],
        )  # fmt: skip
        melody_key = (est.root, est.mode)
    root = _pick(
        "keyRoot", request.key_root, hints.key_root,
        melody_key[0] if melody_key else rng.choice(d.keys), src,
    )  # fmt: skip
    mode = _pick(
        "keyMode", request.key_mode, hints.key_mode,
        melody_key[1] if melody_key else MOOD_MODE[mood], src,
    )  # fmt: skip
    if melody_key:
        for field in ("keyRoot", "keyMode"):
            if src[field] == "default":
                src[field] = "melody"

    structure = _pick("structure", request.structure, hints.structure, None, src)
    duration = request.duration_seconds or hints.duration_seconds
    if duration is not None:
        src["duration"] = "user" if request.duration_seconds else "prompt"
        target_bars = max(4, round(duration * bpm / 240 / 4) * 4)
        if structure is None:
            structure = "loop" if target_bars <= 8 else "short" if target_bars <= 40 else "full"
            src["structure"] = src["duration"]
        bars = _fit_bars(structure, target_bars)
    else:
        if structure is None:
            structure = "short"
        bars = STRUCTURE_BARS[structure]

    if request.instruments is not None:
        instruments = list(dict.fromkeys(request.instruments))
        src["instruments"] = "user"
    else:
        instruments = list(dict.fromkeys([*d.instruments, *hints.include]))
        instruments = [i for i in instruments if i not in hints.exclude]
        src["instruments"] = "prompt" if hints.include or hints.exclude else "default"
    melody_bars = None
    if melody is not None:
        end = max(n.start_beat + n.duration_beats for n in melody.notes)
        if end > MAX_MELODY_BEATS:
            warnings.append("Only the first 16 bars of the melody were used.")
            end = MAX_MELODY_BEATS
        melody_bars = next(b for b in (1, 2, 4, 8, 16) if b * 4 >= end - 1e-6)
        m = melody.instrument
        if m not in instruments:
            instruments.append(m)
        if m != "lead" and "lead" in instruments and request.instruments is None:
            instruments.remove("lead")
            warnings.append("The generated lead was left out so it doesn't clash with your melody.")
        if m == "keys" and "pad" not in instruments:
            instruments.append("pad")  # something else has to play the chords
    drum_bars = None
    drum_input = request.drums
    if drum_input is not None:
        end = max(h.start_beat for h in drum_input.hits) + 0.25
        if end > MAX_DRUM_BEATS:
            warnings.append("Only the first 8 bars of the drum pattern were used.")
            end = MAX_DRUM_BEATS
        drum_bars = next(b for b in (1, 2, 4, 8) if b * 4 >= end - 1e-6)
        used = list(dict.fromkeys(h.drum for h in drum_input.hits))
        if request.instruments is None:
            melodic = [i for i in instruments if i not in DRUM_NAMES]
            extra: list[InstrumentName] = []
            if drum_input.mode == "expand":
                # Add the genre's complementary drums the user didn't beatbox, plus an
                # open-hat accent, which suits every style here.
                genre_extras = [i for i in instruments if i in ("hihat", "openhat", "clap", "perc")]
                extra = [i for i in dict.fromkeys([*genre_extras, "openhat"]) if i not in used]
            instruments = [*used, *extra, *melodic]
        else:
            instruments = list(dict.fromkeys([*used, *instruments]))
    if not instruments:
        warnings.append("No instruments left after exclusions; used the genre's defaults.")
        instruments = list(d.instruments)

    complexity = _pick("complexity", request.complexity, hints.complexity, 0.5, src)
    drums = _pick(
        "drumIntensity", request.drum_intensity, hints.drum_intensity,
        min(1.0, 0.35 + energy * 0.5), src,
    )  # fmt: skip
    bass = _pick("bassIntensity", request.bass_intensity, hints.bass_intensity, 0.6, src)
    melodic = _pick(
        "melodicComplexity", request.melodic_complexity, hints.melodic_complexity, complexity, src
    )

    title = request.name or hints.title or _title(mood, genre)
    plan = GenerationPlan(
        title=title[:120],
        genre=genre,
        mood=mood,
        energy=float(energy),
        bpm=float(bpm),
        key=MusicalKey(root=root, mode=mode),
        structure=structure,
        bars=bars,
        instruments=instruments,
        complexity=float(complexity),
        drum_intensity=float(drums),
        bass_intensity=float(bass),
        melodic_complexity=float(melodic),
        seed=seed,
        sources=src,
        interpreter=interpreter,
        interpreter_model=model,
        warnings=list(dict.fromkeys(warnings)),
        melody_bars=melody_bars,
        melody_instrument=melody.instrument if melody else None,
        melody_mode=melody.mode if melody else None,
        drum_bars=drum_bars,
        drum_mode=drum_input.mode if drum_input else None,
    )
    # Report the real length: sections are rounded so the melody fits whole.
    return plan.model_copy(update={"bars": sum(b for _, _, b in plan_sections(plan))})


def _fit_bars(structure: str, target: int) -> int:
    if structure == "loop":
        return max(4, min(16, target))
    if structure == "short":
        return max(24, min(48, target))
    return max(40, min(128, target))


GENRE_LABEL = {
    "trap": "Trap", "drill": "Drill", "boombap": "Boom Bap",
    "lofi": "Lo-fi", "house": "House", "pop": "Pop",
}  # fmt: skip


def _title(mood: str, genre: str) -> str:
    return f"{mood.capitalize()} {GENRE_LABEL[genre]} Beat"
