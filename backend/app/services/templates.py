"""Starting content for new projects.

These are hand-written, deterministic templates, not generated music. The
instrument presets named here (drum/kick, synth/bass, ...) are implemented by the
frontend audio engine in frontend/src/audio/instruments.ts. Drum notes use General
MIDI percussion numbers so MIDI export maps them correctly later.
"""

from typing import Literal

from app.schemas.project import (
    Clip,
    Instrument,
    MidiNote,
    MixerSettings,
    MusicalKey,
    Pattern,
    ProjectDocument,
    TimeSignature,
    Track,
    empty_project,
    new_id,
)

TemplateName = Literal["empty", "starter", "demo"]

STEPS_PER_BEAT = 4  # sixteenth-note grid

# preset -> (display name, GM pitch or default root, color, kind)
DRUMS = {
    "kick": ("Kick", 36, "#f0596b"),
    "snare": ("Snare", 38, "#f5b84a"),
    "clap": ("Clap", 39, "#f58f4a"),
    "hihat": ("Hi-hat", 42, "#3ecf8e"),
    "openhat": ("Open hat", 46, "#2fb7a0"),
    "perc": ("Perc", 37, "#4ab3f5"),
}
SYNTHS = {
    "bass": ("808 Bass", "#8b6cff"),
    "lead": ("Lead", "#e46cff"),
    "pad": ("Pad", "#6c8bff"),
    "pluck": ("Pluck", "#ff6cb5"),
    "keys": ("Keys", "#f5d76c"),
}


def _drum_track(doc: ProjectDocument, preset: str, steps: list[int], bars: int = 1) -> None:
    name, pitch, color = DRUMS[preset]
    beats_per_bar = doc.time_signature.numerator * 4 / doc.time_signature.denominator
    pattern = Pattern(
        id=new_id("pat"),
        name=name,
        length_beats=beats_per_bar * bars,
        notes=[
            MidiNote(
                id=new_id("note"),
                pitch=pitch,
                start_beat=s / STEPS_PER_BEAT,
                duration_beats=1 / STEPS_PER_BEAT,
                velocity=100,
            )
            for s in steps
        ],
    )
    _add(
        doc,
        Track(
            id=new_id("trk"),
            name=name,
            kind="drums",
            role=preset,
            color=color,
            instrument=Instrument(type="drum", preset=preset),
        ),
        pattern,
    )


def _synth_track(
    doc: ProjectDocument,
    preset: str,
    notes: list[tuple[float, float, int]],
    bars: int,
    volume_db: float = 0.0,
) -> None:
    name, color = SYNTHS[preset]
    beats_per_bar = doc.time_signature.numerator * 4 / doc.time_signature.denominator
    pattern = Pattern(
        id=new_id("pat"),
        name=name,
        length_beats=beats_per_bar * bars,
        notes=[
            MidiNote(id=new_id("note"), pitch=p, start_beat=s, duration_beats=d, velocity=100)
            for s, d, p in notes
        ],
    )
    _add(
        doc,
        Track(
            id=new_id("trk"),
            name=name,
            kind="instrument",
            role=preset,
            color=color,
            instrument=Instrument(type="synth", preset=preset),
            mixer=MixerSettings(volume_db=volume_db),
        ),
        pattern,
    )


def _add(doc: ProjectDocument, track: Track, pattern: Pattern) -> None:
    doc.tracks.append(track)
    doc.patterns.append(pattern)


def _add_clips(doc: ProjectDocument, loop_beats: float) -> None:
    """One clip per track, each looping its pattern across the whole loop."""
    for track, pattern in zip(doc.tracks, doc.patterns, strict=True):
        doc.clips.append(
            Clip(
                id=new_id("clp"),
                track_id=track.id,
                pattern_id=pattern.id,
                start_beat=0,
                length_beats=loop_beats,
            )
        )


def build_project(
    name: str,
    template: TemplateName,
    bpm: float | None = None,
    key: MusicalKey | None = None,
    time_signature: TimeSignature | None = None,
) -> ProjectDocument:
    doc = empty_project(name, bpm=bpm or (140 if template == "demo" else 120))
    if time_signature is not None:
        doc.time_signature = time_signature
    if template == "demo":
        doc.key = MusicalKey(root="A", mode="minor")
    if key is not None:
        doc.key = key
    if template == "empty":
        return doc

    beats_per_bar = doc.time_signature.numerator * 4 / doc.time_signature.denominator
    if template == "starter":
        for preset in ("kick", "snare", "hihat", "clap"):
            _drum_track(doc, preset, [])
        _synth_track(doc, "bass", [], bars=1)
        _synth_track(doc, "lead", [], bars=1)
        _add_clips(doc, loop_beats=beats_per_bar * 2)
        return ProjectDocument.model_validate(doc.model_dump())

    # Demo beat: two-bar loop in A minor, trap-style drums, 808 bass and a lead line.
    _drum_track(doc, "kick", [0, 7, 10])
    _drum_track(doc, "snare", [8])
    _drum_track(doc, "clap", [8])
    _drum_track(doc, "hihat", [0, 2, 4, 6, 8, 10, 11, 12, 14, 15])
    # (start beat, duration beats, MIDI pitch): A1, F1, C2, G1
    _synth_track(doc, "bass", [(0, 1.75, 33), (2, 2, 29), (4, 1.75, 36), (6, 2, 31)], bars=2)
    lead = [
        (0, 0.5, 76), (0.5, 0.5, 74), (1, 1, 72), (2, 0.5, 69), (2.5, 0.5, 72), (3, 1, 74),
        (4, 0.5, 76), (4.5, 0.5, 79), (5, 1, 76), (6, 0.5, 74), (6.5, 0.5, 72), (7, 1, 69),
    ]  # fmt: skip
    _synth_track(doc, "lead", lead, bars=2, volume_db=-6)
    _add_clips(doc, loop_beats=beats_per_bar * 2)
    # Re-validate so integrity checks (ids, references) run on the finished document.
    return ProjectDocument.model_validate(doc.model_dump())
