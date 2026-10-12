"""Versioned VibeStudio project document schema.

The project document is the single source of truth for a song's musical content.
Every entity has a stable string id so AI edit commands (Phase 8) can target it
precisely. Times are expressed in beats (quarter notes) so tempo changes never
require rewriting note data.

Bump PROJECT_SCHEMA_VERSION and add a migration in app/services/migrations.py
whenever the shape changes incompatibly.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

PROJECT_SCHEMA_VERSION = 1

Id = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")]
Color = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
Beats = Annotated[float, Field(ge=0, le=100_000)]
ParamValue = float | int | str | bool

NoteName = Literal["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def utcnow() -> datetime:
    return datetime.now(UTC)


class Model(BaseModel):
    """Base model: camelCase on the wire, strict about unknown fields."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        serialize_by_alias=True,
        # Defaults are always present in serialized output, so mark them required
        # in the serialization schema the frontend types are generated from.
        json_schema_serialization_defaults_required=True,
    )


class MusicalKey(Model):
    root: NoteName = "C"
    mode: Literal["major", "minor"] = "minor"


class TimeSignature(Model):
    numerator: int = Field(4, ge=1, le=32)
    denominator: Literal[1, 2, 4, 8, 16, 32] = 4


class MidiNote(Model):
    id: Id
    pitch: int = Field(ge=0, le=127, description="MIDI note number")
    start_beat: Beats = Field(description="Offset from the pattern start, in beats")
    duration_beats: float = Field(gt=0, le=10_000)
    velocity: int = Field(100, ge=1, le=127)
    confidence: float | None = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Transcription confidence (0-1) for notes detected from audio. "
        "Null for notes entered or confirmed by the user.",
    )


class Pattern(Model):
    """A reusable block of MIDI notes. Clips place patterns on the timeline."""

    id: Id
    name: str = Field(min_length=1, max_length=120)
    length_beats: float = Field(gt=0, le=10_000)
    notes: list[MidiNote] = Field(default_factory=list, max_length=50_000)


class Instrument(Model):
    """Instrument reference. `type` selects an engine implementation. `params` are
    engine-specific and validated by that engine, not by this schema."""

    type: str = Field(min_length=1, max_length=64, examples=["synth", "drumkit"])
    preset: str | None = Field(None, max_length=120)
    params: dict[str, ParamValue] = Field(default_factory=dict)


class Effect(Model):
    id: Id
    type: str = Field(min_length=1, max_length=64)
    enabled: bool = True
    params: dict[str, ParamValue] = Field(default_factory=dict)


class MixerSettings(Model):
    volume_db: float = Field(0.0, ge=-96.0, le=12.0)
    pan: float = Field(0.0, ge=-1.0, le=1.0)
    mute: bool = False
    solo: bool = False


class Track(Model):
    id: Id
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["instrument", "drums", "audio"]
    role: str | None = Field(
        None, max_length=64, description="Musical role hint, e.g. kick, 808, lead, vocal_lead"
    )
    color: Color = "#7c5cff"
    instrument: Instrument | None = None
    mixer: MixerSettings = Field(default_factory=MixerSettings)
    effects: list[Effect] = Field(default_factory=list, max_length=64)


class Clip(Model):
    """Places a pattern (MIDI) or an audio asset on a track's timeline."""

    id: Id
    track_id: Id
    pattern_id: Id | None = None
    asset_id: Id | None = None
    start_beat: Beats
    length_beats: float = Field(gt=0, le=100_000)
    offset_beats: Beats = Field(0.0, description="Where inside the source the clip starts")

    @model_validator(mode="after")
    def _exactly_one_source(self) -> Clip:
        if (self.pattern_id is None) == (self.asset_id is None):
            raise ValueError("clip must reference exactly one of patternId or assetId")
        return self


class ArrangementSection(Model):
    id: Id
    name: str = Field(min_length=1, max_length=60, examples=["Intro", "Verse 1", "Hook"])
    start_beat: Beats
    length_beats: float = Field(gt=0, le=100_000)


class AudioAsset(Model):
    """Immutable reference to stored audio. Edits never modify the source file."""

    id: Id
    name: str = Field(min_length=1, max_length=255)
    uri: str = Field(min_length=1, max_length=1024)
    sha256: str | None = Field(None, pattern=r"^[0-9a-f]{64}$")
    sample_rate: int | None = Field(None, ge=8000, le=384_000)
    channels: int | None = Field(None, ge=1, le=8)
    duration_seconds: float | None = Field(None, ge=0)

    @field_validator("uri")
    @classmethod
    def _safe_uri(cls, v: str) -> str:
        # Assets live in managed storage. Reject absolute paths, traversal and
        # arbitrary schemes so a project document can never point at host files.
        if not re.fullmatch(r"asset://[A-Za-z0-9_\-./]+", v) or ".." in v:
            raise ValueError("uri must be an asset:// reference without '..'")
        return v


class AiPromptRecord(Model):
    id: Id
    created_at: datetime
    prompt: str = Field(max_length=4000)
    summary: str | None = Field(None, max_length=4000)


class ProjectDocument(Model):
    schema_version: Literal[1] = PROJECT_SCHEMA_VERSION
    id: Id
    name: str = Field(min_length=1, max_length=120)
    bpm: float = Field(120.0, ge=20.0, le=400.0)
    key: MusicalKey = Field(default_factory=MusicalKey)
    time_signature: TimeSignature = Field(default_factory=TimeSignature)
    tracks: list[Track] = Field(default_factory=list, max_length=256)
    patterns: list[Pattern] = Field(default_factory=list, max_length=2048)
    clips: list[Clip] = Field(default_factory=list, max_length=10_000)
    sections: list[ArrangementSection] = Field(default_factory=list, max_length=256)
    assets: list[AudioAsset] = Field(default_factory=list, max_length=2048)
    ai_history: list[AiPromptRecord] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def _check_integrity(self) -> ProjectDocument:
        """Reject duplicate ids and dangling references (e.g. clip -> deleted track)."""
        seen: set[str] = set()

        def claim(kind: str, ident: str) -> None:
            if ident in seen:
                raise ValueError(f"duplicate id '{ident}' ({kind})")
            seen.add(ident)

        for t in self.tracks:
            claim("track", t.id)
            for fx in t.effects:
                claim("effect", fx.id)
        for p in self.patterns:
            claim("pattern", p.id)
            for n in p.notes:
                claim("note", n.id)
        for c in self.clips:
            claim("clip", c.id)
        for s in self.sections:
            claim("section", s.id)
        for a in self.assets:
            claim("asset", a.id)

        track_ids = {t.id for t in self.tracks}
        pattern_ids = {p.id for p in self.patterns}
        asset_ids = {a.id for a in self.assets}
        for c in self.clips:
            if c.track_id not in track_ids:
                raise ValueError(f"clip '{c.id}' references unknown track '{c.track_id}'")
            if c.pattern_id is not None and c.pattern_id not in pattern_ids:
                raise ValueError(f"clip '{c.id}' references unknown pattern '{c.pattern_id}'")
            if c.asset_id is not None and c.asset_id not in asset_ids:
                raise ValueError(f"clip '{c.id}' references unknown asset '{c.asset_id}'")
        return self


def empty_project(name: str, bpm: float = 120.0, project_id: str | None = None) -> ProjectDocument:
    return ProjectDocument(id=project_id or new_id("prj"), name=name, bpm=bpm)
