import io

import mido

from app.generation.composer import compose
from app.generation.params import GenerationRequest
from app.generation.resolve import resolve_plan
from app.services.midi import TICKS_PER_BEAT, expand_events, to_midi
from app.services.templates import build_project


def parse(data: bytes) -> mido.MidiFile:
    return mido.MidiFile(file=io.BytesIO(data))


def note_ons(track: mido.MidiTrack) -> list[tuple[int, int, int]]:
    out, t = [], 0
    for msg in track:
        t += msg.time
        if msg.type == "note_on" and msg.velocity > 0:
            out.append((t, msg.note, msg.channel))
    return out


def test_demo_midi_matches_playback_events():
    doc = build_project("Demo", "demo")
    mid = parse(to_midi(doc))
    assert mid.type == 1 and mid.ticks_per_beat == TICKS_PER_BEAT
    assert len(mid.tracks) == 1 + len(doc.tracks)
    tempo = next(m for m in mid.tracks[0] if m.type == "set_tempo")
    assert round(mido.tempo2bpm(tempo.tempo)) == 140

    events = expand_events(doc)
    for track, mt in zip(doc.tracks, mid.tracks[1:], strict=True):
        ons = note_ons(mt)
        assert len(ons) == len(events[track.id]), track.name
        assert [t for t, _, _ in ons] == [round(e.beat * TICKS_PER_BEAT) for e in events[track.id]]
        channels = {c for _, _, c in ons}
        assert channels == ({9} if track.kind == "drums" else channels - {9})


def test_generated_song_exports_with_markers_and_selected_tracks():
    plan = resolve_plan(GenerationRequest(prompt="dark trap", structure="short", seed=4))
    doc = compose(plan)
    mid = parse(to_midi(doc))
    markers = [m.text for m in mid.tracks[0] if m.type == "marker"]
    assert markers == [s.name for s in doc.sections]
    one = parse(to_midi(doc, [doc.tracks[0].id]))
    assert len(one.tracks) == 2


def test_generate_endpoint_creates_editable_project(client):
    r = client.post("/api/generate", json={"prompt": "uplifting house, 30 seconds", "seed": 9})
    assert r.status_code == 201, r.text
    body = r.json()
    plan, project = body["plan"], body["project"]
    assert plan["genre"] == "house" and plan["sources"]["genre"] == "prompt"
    doc = project["document"]
    assert len(doc["tracks"]) >= 4 and doc["sections"]
    assert doc["aiHistory"][0]["prompt"] == "uplifting house, 30 seconds"
    # It is a normal project: it can be reopened, edited and saved.
    got = client.get(f"/api/projects/{doc['id']}").json()
    assert got["document"] == doc
    revs = client.get(f"/api/projects/{doc['id']}/revisions").json()
    assert revs[0]["message"].startswith("Generated (house")
    doc["bpm"] = 100
    assert (
        client.put(
            f"/api/projects/{doc['id']}", json={"baseRevision": 1, "document": doc}
        ).status_code
        == 200
    )


def test_plan_endpoint_does_not_create_projects(client):
    r = client.post("/api/generate/plan", json={"prompt": "lofi in D minor", "seed": 1})
    assert r.status_code == 200
    assert r.json()["key"] == {"root": "D", "mode": "minor"}
    assert client.get("/api/projects").json() == []


def test_generate_validation(client):
    assert client.post("/api/generate", json={"prompt": "x" * 1001}).status_code == 422
    assert client.post("/api/generate", json={"bpm": 500}).status_code == 422
    assert client.post("/api/generate", json={"instruments": ["kazoo"]}).status_code == 422


def test_midi_export_endpoint(client):
    doc = build_project("My Beat!", "demo").model_dump(mode="json")
    r = client.post("/api/export/midi", json={"document": doc})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/midi"
    assert 'filename="My Beat.mid"' in r.headers["content-disposition"]
    assert r.content[:4] == b"MThd"
    bad = client.post("/api/export/midi", json={"document": doc, "trackIds": ["nope"]})
    assert bad.status_code == 422
