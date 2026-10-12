import io

import numpy as np
import pytest
import soundfile as sf

from app.config import get_settings
from tests.hum_synth import TWINKLE, hum_wav


@pytest.fixture(autouse=True)
def tmp_assets(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "assets_dir", tmp_path / "assets")
    return tmp_path / "assets"


def upload(client, data: bytes, **params):
    return client.post(
        "/api/assets", content=data, params={"kind": "hum", "name": "take.wav", **params},
        headers={"Content-Type": "audio/wav"},
    )  # fmt: skip


def test_upload_stores_immutable_content_addressed_file(client, tmp_assets):
    data = hum_wav()
    r = upload(client, data, name="../../etc/My Take!.wav")
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["uri"] == f"asset://audio/{a['id']}"
    assert a["name"] == "My Take.wav"  # directory parts and odd characters stripped
    assert a["sampleRate"] == 22050 and a["channels"] == 1 and a["durationSeconds"] > 8
    stored = list(tmp_assets.rglob("*.wav"))
    assert [p.name for p in stored] == [f"{a['sha256']}.wav"]
    assert stored[0].read_bytes() == data
    # Same content uploaded again reuses the file but gets its own asset id.
    b = upload(client, data).json()
    assert b["id"] != a["id"] and len(list(tmp_assets.rglob("*.wav"))) == 1
    audio = client.get(f"/api/assets/{a['id']}/audio")
    assert audio.status_code == 200 and audio.content == data
    assert audio.headers["content-type"] == "audio/wav"
    assert client.get(f"/api/assets/{a['id']}").json()["sha256"] == a["sha256"]


def test_upload_rejects_bad_input(client, monkeypatch):
    assert upload(client, b"not audio at all").status_code == 422
    assert upload(client, b"").status_code == 422
    assert upload(client, hum_wav(), kind="malware").status_code == 422
    buf = io.BytesIO()
    sf.write(buf, np.zeros(22050 * 3, dtype=np.float32), 22050, format="WAV")
    monkeypatch.setattr(get_settings(), "max_upload_seconds", 2.0)
    assert "longer than" in upload(client, buf.getvalue()).json()["detail"]
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 1000)
    assert upload(client, hum_wav()).status_code == 413
    assert client.get("/api/assets/ast_missing").status_code == 404
    assert client.get("/api/assets/ast_missing/audio").status_code == 404


def test_transcribe_endpoint(client):
    asset = upload(client, hum_wav()).json()
    r = client.post("/api/transcribe/melody", json={"assetId": asset["id"]})
    assert r.status_code == 200, r.text
    t = r.json()
    assert [n["pitch"] for n in t["notes"]] == [p for p, _, _ in TWINKLE]
    assert t["method"] == "pyin-v1" and t["key"]["root"] == "C"
    assert set(t["notes"][0]) == {"start", "end", "pitch", "pitchCents", "confidence", "velocity"}
    assert client.post("/api/transcribe/melody", json={"assetId": "ast_nope"}).status_code == 404


def melody_request(**kw):
    notes = [
        {
            "startBeat": s,
            "durationBeats": d - 0.1,
            "pitch": p + 12,
            "confidence": 0.4 if i == 2 else 0.95,
        }
        for i, (p, s, d) in enumerate(TWINKLE)
    ]  # fmt: skip
    return {"prompt": "melodic trap beat with heavy bass", "seed": 3,
            "melody": {"notes": notes, **kw}}  # fmt: skip


def test_beat_built_around_melody_keeps_it_and_fits_it(client):
    asset = upload(client, hum_wav()).json()
    r = client.post("/api/generate", json=melody_request(sourceAssetId=asset["id"]))
    assert r.status_code == 201, r.text
    plan, doc = r.json()["plan"], r.json()["project"]["document"]
    assert plan["key"] == {"root": "C", "mode": "major"} and plan["sources"]["keyRoot"] == "melody"
    assert plan["melodyBars"] == 4 and plan["melodyMode"] == "keep"
    # The recording is preserved in the project.
    assert [a["id"] for a in doc["assets"]] == [asset["id"]]

    melody_track = next(t for t in doc["tracks"] if t["name"] == "Melody")
    patterns = {p["id"]: p for p in doc["patterns"]}
    hook = next(s for s in doc["sections"] if s["name"] == "Hook")
    clip = next(c for c in doc["clips"] if c["trackId"] == melody_track["id"]
                and c["startBeat"] == hook["startBeat"])  # fmt: skip
    notes = patterns[clip["patternId"]]["notes"]
    # Keep mode: exactly the user's notes, with transcription confidence carried over.
    assert [(n["startBeat"], n["pitch"]) for n in notes] == [(s, p + 12) for p, s, _ in TWINKLE]
    assert notes[2]["confidence"] == 0.4
    # Not in the intro; the generated lead stays out of the way.
    assert all(
        c["startBeat"] >= hook["startBeat"]
        for c in doc["clips"]
        if c["trackId"] == melody_track["id"]
    )
    assert "lead" not in {t["role"] for t in doc["tracks"]} - {melody_track["role"]}

    # Chords fit the melody: most melody time on strong beats lands on chord tones.
    pad = next(t for t in doc["tracks"] if t["role"] == "pad")
    pad_clip = next(
        c for c in doc["clips"] if c["trackId"] == pad["id"] and c["startBeat"] == hook["startBeat"]
    )
    chord_notes = patterns[pad_clip["patternId"]]["notes"]
    hits = 0
    for p, s, _ in TWINKLE:
        bar_pcs = {n["pitch"] % 12 for n in chord_notes if int(n["startBeat"] // 4) == int(s // 4)}
        hits += p % 12 in bar_pcs
    assert hits / len(TWINKLE) >= 0.7


def test_vary_mode_and_other_instruments(client):
    r = client.post("/api/generate", json=melody_request(mode="vary", instrument="keys"))
    plan, doc = r.json()["plan"], r.json()["project"]["document"]
    assert plan["melodyMode"] == "vary" and "pad" in plan["instruments"]
    melody_track = next(t for t in doc["tracks"] if t["name"] == "Melody")
    assert melody_track["instrument"]["preset"] == "keys"
    verse = next(s for s in doc["sections"] if s["name"] == "Verse")
    assert any(
        c["trackId"] == melody_track["id"] and c["startBeat"] == verse["startBeat"]
        for c in doc["clips"]
    )


def test_long_melody_and_sections_fit(client):
    long = {"prompt": "", "seed": 1, "melody": {"notes": [
        {"startBeat": i * 2, "durationBeats": 1.5, "pitch": 60 + (i % 5)} for i in range(14)
    ]}}  # fmt: skip
    plan = client.post("/api/generate/plan", json=long).json()
    assert plan["melodyBars"] == 8
    doc = client.post("/api/generate", json=long).json()["project"]["document"]
    for s in doc["sections"]:
        if s["name"].startswith(("Hook", "Verse")):
            assert s["lengthBeats"] % 32 == 0  # whole melody lengths
    assert client.post("/api/generate", json={"melody": {"notes": []}}).status_code == 422
