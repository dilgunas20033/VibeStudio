"""Parameters for beat generation: the request, prompt hints, and the resolved plan."""

from typing import Literal

from pydantic import Field

from app.schemas.project import Model, MusicalKey, NoteName

Genre = Literal["trap", "drill", "boombap", "lofi", "house", "pop"]
Mood = Literal["dark", "emotional", "uplifting", "chill", "aggressive", "dreamy"]
Structure = Literal["loop", "short", "full"]
InstrumentName = Literal[
    "kick", "snare", "clap", "hihat", "openhat", "perc", "bass", "lead", "pad", "pluck", "keys"
]
Source = Literal["user", "prompt", "melody", "default"]
MelodyInstrument = Literal["lead", "pluck", "keys"]
MAX_MELODY_BEATS = 64  # 16 bars of 4/4

GENRES: tuple[Genre, ...] = ("trap", "drill", "boombap", "lofi", "house", "pop")
MOODS: tuple[Mood, ...] = ("dark", "emotional", "uplifting", "chill", "aggressive", "dreamy")
DRUMS: tuple[InstrumentName, ...] = ("kick", "snare", "clap", "hihat", "openhat", "perc")
MELODIC: tuple[InstrumentName, ...] = ("bass", "lead", "pad", "pluck", "keys")


def unit():
    """An optional 0..1 control. A fresh FieldInfo per field."""
    return Field(None, ge=0.0, le=1.0)


class MelodyNote(Model):
    start_beat: float = Field(ge=0, le=10_000)
    duration_beats: float = Field(gt=0, le=64)
    pitch: int = Field(ge=0, le=127)
    velocity: int = Field(100, ge=1, le=127)
    confidence: float | None = Field(None, ge=0, le=1)


class MelodyInput(Model):
    """A melody to build the beat around (e.g. transcribed humming), in beats from bar 1."""

    notes: list[MelodyNote] = Field(min_length=1, max_length=512)
    instrument: MelodyInstrument = "lead"
    mode: Literal["keep", "vary"] = Field(
        "keep",
        description="keep: the melody is used exactly as given. vary: the verse also plays a "
        "variation of it (the hook always keeps the original notes).",
    )
    source_asset_id: str | None = Field(
        None, max_length=64, description="Recording the melody came from; kept in the project"
    )


DrumName = Literal["kick", "snare", "clap", "hihat", "openhat", "perc"]
MAX_DRUM_BEATS = 32  # 8 bars of 4/4


class DrumHitInput(Model):
    start_beat: float = Field(ge=0, le=10_000)
    drum: DrumName
    velocity: int = Field(100, ge=1, le=127)


class DrumsInput(Model):
    """A drum pattern to build the beat around (e.g. transcribed beatboxing), in beats."""

    hits: list[DrumHitInput] = Field(min_length=1, max_length=1024)
    mode: Literal["keep", "expand"] = Field(
        "expand",
        description="keep: the hook and verse play exactly these hits. expand: the hook adds "
        "complementary parts (hats, open hats, fills) and the verse is a thinned version.",
    )
    source_asset_id: str | None = Field(None, max_length=64)


class GenerationRequest(Model):
    """What the user asks for. Every setting is optional; unset means "decide for me"."""

    prompt: str = Field("", max_length=1000)
    name: str | None = Field(None, min_length=1, max_length=120)
    genre: Genre | None = None
    mood: Mood | None = None
    energy: float | None = unit()
    bpm: float | None = Field(None, ge=40.0, le=220.0)
    key_root: NoteName | None = None
    key_mode: Literal["major", "minor"] | None = None
    structure: Structure | None = None
    duration_seconds: float | None = Field(None, ge=8.0, le=300.0)
    instruments: list[InstrumentName] | None = Field(None, min_length=1, max_length=11)
    complexity: float | None = unit()
    drum_intensity: float | None = unit()
    bass_intensity: float | None = unit()
    melodic_complexity: float | None = unit()
    seed: int | None = Field(None, ge=0, le=2**31 - 1)
    interpreter: Literal["auto", "rules", "llm"] = Field(
        "auto", description="auto: LLM if configured, otherwise keyword rules"
    )
    melody: MelodyInput | None = None
    drums: DrumsInput | None = None


class PromptHints(Model):
    """Parameters read from the prompt text. Anything not mentioned stays None."""

    genre: Genre | None = None
    mood: Mood | None = None
    energy: float | None = unit()
    bpm: float | None = Field(None, ge=40.0, le=220.0)
    key_root: NoteName | None = None
    key_mode: Literal["major", "minor"] | None = None
    structure: Structure | None = None
    duration_seconds: float | None = Field(None, ge=8.0, le=300.0)
    include: list[InstrumentName] = Field(default_factory=list)
    exclude: list[InstrumentName] = Field(default_factory=list)
    complexity: float | None = unit()
    drum_intensity: float | None = unit()
    bass_intensity: float | None = unit()
    melodic_complexity: float | None = unit()
    title: str | None = Field(None, max_length=120)
    notes: list[str] = Field(
        default_factory=list, description="Things asked for that can't be honoured exactly"
    )


class GenerationPlan(Model):
    """Fully resolved parameters the composer runs on. Shown to the user before/after."""

    title: str
    genre: Genre
    mood: Mood
    energy: float
    bpm: float
    key: MusicalKey
    structure: Structure
    bars: int
    instruments: list[InstrumentName]
    complexity: float
    drum_intensity: float
    bass_intensity: float
    melodic_complexity: float
    seed: int
    sources: dict[str, Source]
    interpreter: Literal["rules", "llm"]
    interpreter_model: str | None = None
    composer: Literal["procedural-v1"] = "procedural-v1"
    melody_bars: int | None = Field(None, description="Length of the supplied melody, in bars")
    melody_instrument: MelodyInstrument | None = None
    melody_mode: Literal["keep", "vary"] | None = None
    drum_bars: int | None = Field(None, description="Length of the supplied drum pattern, in bars")
    drum_mode: Literal["keep", "expand"] | None = None
    warnings: list[str] = Field(default_factory=list)
