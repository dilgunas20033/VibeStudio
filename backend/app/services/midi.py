"""Standard MIDI File export (type 1) for FL Studio and other DAWs.

One MIDI track per project track, plus a conductor track with tempo, time signature and
section markers. Drum tracks go on channel 10 with General MIDI percussion notes; synth
tracks get a General MIDI program so they sound roughly right in a GM player.
"""

import io
from dataclasses import dataclass

import mido

from app.schemas.project import ProjectDocument, Track

TICKS_PER_BEAT = 480
DRUM_CHANNEL = 9
# General MIDI programs (0-based) per synth preset.
GM_PROGRAMS = {"bass": 38, "lead": 81, "pad": 88, "pluck": 46, "keys": 4}
EPS = 1e-9


@dataclass(frozen=True)
class NoteEvent:
    beat: float
    duration: float
    pitch: int
    velocity: int


def expand_events(doc: ProjectDocument) -> dict[str, list[NoteEvent]]:
    """Clip/pattern expansion. Mirrors frontend/src/audio/schedule.ts collectEvents, so the
    MIDI file contains exactly what the app plays."""
    patterns = {p.id: p for p in doc.patterns}
    events: dict[str, list[NoteEvent]] = {t.id: [] for t in doc.tracks}
    for clip in doc.clips:
        pattern = patterns.get(clip.pattern_id or "")
        if pattern is None or clip.track_id not in events:
            continue
        clip_end = clip.start_beat + clip.length_beats
        rep = int(clip.offset_beats // pattern.length_beats)
        while True:
            rep_start = clip.start_beat + rep * pattern.length_beats - clip.offset_beats
            if rep_start >= clip_end - EPS:
                break
            for n in pattern.notes:
                if n.start_beat >= pattern.length_beats - EPS:
                    continue
                beat = rep_start + n.start_beat
                if beat < clip.start_beat - EPS or beat >= clip_end - EPS:
                    continue
                events[clip.track_id].append(
                    NoteEvent(beat, min(n.duration_beats, clip_end - beat), n.pitch, n.velocity)
                )
            rep += 1
    for lst in events.values():
        lst.sort(key=lambda e: (e.beat, e.pitch))
    return events


def _ticks(beats: float) -> int:
    return round(beats * TICKS_PER_BEAT)


def _to_delta(abs_msgs: list[tuple[int, int, mido.Message]]) -> list[mido.Message]:
    """(abs_tick, order, msg) -> delta-timed messages. Note-offs sort before note-ons."""
    out, now = [], 0
    for tick, _, msg in sorted(abs_msgs, key=lambda m: (m[0], m[1])):
        out.append(msg.copy(time=tick - now))
        now = tick
    return out


def _channel_for(track: Track, index: int) -> int:
    if track.kind == "drums":
        return DRUM_CHANNEL
    ch = index % 15
    return ch if ch < DRUM_CHANNEL else ch + 1


def to_midi(doc: ProjectDocument, track_ids: list[str] | None = None) -> bytes:
    selected = [t for t in doc.tracks if track_ids is None or t.id in track_ids]
    events = expand_events(doc)
    mid = mido.MidiFile(type=1, ticks_per_beat=TICKS_PER_BEAT)

    conductor = mido.MidiTrack()
    conductor.append(mido.MetaMessage("track_name", name=doc.name[:100], time=0))
    conductor.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(doc.bpm), time=0))
    conductor.append(
        mido.MetaMessage(
            "time_signature",
            numerator=doc.time_signature.numerator,
            denominator=doc.time_signature.denominator,
            time=0,
        )
    )
    markers = [
        (_ticks(s.start_beat), 0, mido.MetaMessage("marker", text=s.name)) for s in doc.sections
    ]
    conductor.extend(_to_delta(markers))
    mid.tracks.append(conductor)

    instrument_index = 0
    for track in selected:
        channel = _channel_for(track, instrument_index)
        if track.kind != "drums":
            instrument_index += 1
        mt = mido.MidiTrack()
        mt.append(mido.MetaMessage("track_name", name=track.name[:100], time=0))
        msgs: list[tuple[int, int, mido.Message]] = []
        if track.kind != "drums":
            program = GM_PROGRAMS.get(track.instrument.preset if track.instrument else "", 0)
            msgs.append((0, 0, mido.Message("program_change", channel=channel, program=program)))
        for e in events.get(track.id, []):
            start = _ticks(e.beat)
            end = max(start + 1, _ticks(e.beat + e.duration))
            msgs.append(
                (
                    start,
                    2,
                    mido.Message("note_on", channel=channel, note=e.pitch, velocity=e.velocity),
                )
            )
            msgs.append(
                (end, 1, mido.Message("note_off", channel=channel, note=e.pitch, velocity=0))
            )
        mt.extend(_to_delta(msgs))
        mid.tracks.append(mt)

    buf = io.BytesIO()
    mid.save(file=buf)
    return buf.getvalue()
