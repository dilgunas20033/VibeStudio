"""Beatbox transcription and drum-based generation, on synthetic takes with known hits."""

import pytest

from app.config import get_settings
from app.generation.composer import compose
from app.generation.params import DrumHitInput, DrumsInput, GenerationRequest
from app.generation.resolve import resolve_plan
from app.services.midi import expand_events
from app.transcription.beatbox import transcribe_beatbox
from tests.beatbox_synth import BOOM_BAP, beatbox, beatbox_wav

EXPECTED = [c for c, _ in BOOM_BAP]


def test_clean_take_is_transcribed_exactly():
    y, sr = beatbox()
    t = transcribe_beatbox(y, sr)
    assert [h.drum for h in t.hits] == EXPECTED
    times = [0.4 + b * 60 / 90 for _, b in BOOM_BAP]
    assert max(abs(h.time - x) for h, x in zip(t.hits, times, strict=True)) < 0.045
    assert t.tempo.bpm == pytest.approx(90, rel=0.02)
    kicks = [h for h in t.hits if h.drum == "kick"]
    hats = [h for h in t.hits if h.drum == "hihat"]
    assert min(k.low_ratio for k in kicks) > max(h.low_ratio for h in hats)
    assert all(0 < h.confidence <= 1 and 1 <= h.velocity <= 127 for h in t.hits)


@pytest.mark.parametrize("bpm", [75, 105, 140])
@pytest.mark.parametrize("noise_db", [-50, -40, -35])
def test_robust_across_tempo_and_noise(bpm, noise_db):
    y, sr = beatbox(bpm=bpm, noise_db=noise_db, seed=bpm + int(-noise_db), jitter_s=0.015)
    t = transcribe_beatbox(y, sr)
    got = [h.drum for h in t.hits]
    assert len(got) == len(EXPECTED)
    assert sum(a == b for a, b in zip(got, EXPECTED, strict=True)) >= 15
    ratio = t.tempo.bpm / bpm
    assert min(abs(ratio - r) for r in (0.5, 1, 2)) < 0.03


def test_very_noisy_room_still_finds_most_hits():
    y, sr = beatbox(noise_db=-30, seed=3)
    t = transcribe_beatbox(y, sr)
    assert abs(len(t.hits) - len(EXPECTED)) <= 2


def test_silence_gives_no_hits():
    import numpy as np

    t = transcribe_beatbox(np.zeros(22050 * 2, dtype=np.float32), 22050)
    assert t.hits == [] and t.warnings


# --- API --------------------------------------------------------------------------------


@pytest.fixture
def assets_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "assets_dir", tmp_path / "assets")


def test_beatbox_endpoint(client, assets_dir):
    up = client.post(
        "/api/assets", content=beatbox_wav(), params={"kind": "beatbox", "name": "bb.wav"}
    )
    assert up.status_code == 201
    r = client.post("/api/transcribe/beatbox", json={"assetId": up.json()["id"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [h["drum"] for h in body["hits"]] == EXPECTED
    assert body["method"] == "onset-rules-v1" and body["tempo"]["bpm"] == pytest.approx(
        90, rel=0.02
    )
    assert client.post("/api/transcribe/beatbox", json={"assetId": "ast_x"}).status_code == 404


# --- generation around a drum pattern ---------------------------------------------------


def drums_request(mode: str, **kw) -> GenerationRequest:
    hits = [DrumHitInput(start_beat=b, drum=c) for c, b in BOOM_BAP if c != "openhat"]
    return GenerationRequest(
        prompt="dark boom bap", bpm=90, seed=2, drums=DrumsInput(hits=hits, mode=mode), **kw
    )


def section_hits(doc, name, role):
    s = next(x for x in doc.sections if x.name == name)
    track = next(t for t in doc.tracks if t.role == role)
    ev = expand_events(doc)[track.id]
    return [
        round(e.beat - s.start_beat, 3) for e in ev if s.start_beat <= e.beat < s.start_beat + 8
    ]


def test_keep_mode_plays_the_groove_exactly():
    req = drums_request("keep")
    plan = resolve_plan(req)
    assert plan.drum_bars == 2 and plan.drum_mode == "keep"
    doc = compose(plan, req.prompt, drums=req.drums)
    kicks = [b for c, b in BOOM_BAP if c == "kick"]
    for section in ("Hook", "Verse"):
        assert section_hits(doc, section, "kick") == kicks
        assert section_hits(doc, section, "snare") == [b for c, b in BOOM_BAP if c == "snare"]
    assert "openhat" not in plan.instruments  # nothing added in keep mode


def test_expand_mode_builds_around_the_groove():
    req = drums_request("expand")
    plan = resolve_plan(req)
    assert {"openhat", "perc"} <= set(plan.instruments)
    doc = compose(plan, req.prompt, drums=req.drums)
    hook = next(s for s in doc.sections if s.name == "Hook")
    ev = expand_events(doc)
    kick = next(t for t in doc.tracks if t.role == "kick")
    hook_kicks = [
        e.beat - hook.start_beat
        for e in ev[kick.id]
        if hook.start_beat <= e.beat < hook.start_beat + 8
    ]
    assert hook_kicks == [b for c, b in BOOM_BAP if c == "kick"]  # the groove itself is kept
    snare = next(t for t in doc.tracks if t.role == "snare")
    hook_end = hook.start_beat + hook.length_beats
    hook_snares = [
        e.beat - hook.start_beat for e in ev[snare.id] if hook.start_beat <= e.beat < hook_end
    ]
    assert any(abs(b % 4 - 3.75) < 1e-6 for b in hook_snares)  # a fill was added
    # The 8-bar hook holds whole repeats of the 2-bar groove.
    assert hook.length_beats % 8 == 0


def test_generate_endpoint_with_drums(client, assets_dir):
    up = client.post("/api/assets", content=beatbox_wav(), params={"kind": "beatbox"}).json()
    hits = [{"startBeat": b, "drum": c, "velocity": 100} for c, b in BOOM_BAP]
    r = client.post(
        "/api/generate",
        json={"prompt": "boom bap", "bpm": 90, "seed": 1,
              "drums": {"hits": hits, "mode": "keep", "sourceAssetId": up["id"]}},
    )  # fmt: skip
    assert r.status_code == 201, r.text
    plan, doc = r.json()["plan"], r.json()["project"]["document"]
    assert plan["drumBars"] == 2 and plan["drumMode"] == "keep"
    assert [a["id"] for a in doc["assets"]] == [up["id"]]
    bad = {"drums": {"hits": [{"startBeat": 0, "drum": "cowbell"}]}}
    assert client.post("/api/generate", json=bad).status_code == 422
