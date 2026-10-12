def create(client, **body):
    r = client.post("/api/projects", json={"name": "My Beat", "template": "empty", **body})
    assert r.status_code == 201, r.text
    return r.json()


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["projectSchemaVersion"] == 1


def test_create_get_and_list(client):
    created = create(client, bpm=145, key={"root": "F#", "mode": "minor"})
    doc = created["document"]
    assert created["revision"] == 1
    assert doc["bpm"] == 145 and doc["key"] == {"root": "F#", "mode": "minor"}

    got = client.get(f"/api/projects/{doc['id']}").json()
    assert got["document"] == doc

    listing = client.get("/api/projects").json()
    assert [p["id"] for p in listing] == [doc["id"]]
    assert listing[0]["trackCount"] == 0


def test_save_creates_revision_and_persists(client):
    created = create(client)
    doc = created["document"]
    doc["bpm"] = 90
    doc["tracks"] = [{"id": "trk_1", "name": "Bass", "kind": "instrument"}]

    r = client.put(
        f"/api/projects/{doc['id']}",
        json={"baseRevision": 1, "message": "add bass", "document": doc},
    )
    assert r.status_code == 200, r.text
    assert r.json()["revision"] == 2

    reopened = client.get(f"/api/projects/{doc['id']}").json()
    assert reopened["document"]["bpm"] == 90
    assert reopened["document"]["tracks"][0]["mixer"]["volumeDb"] == 0.0

    revs = client.get(f"/api/projects/{doc['id']}/revisions").json()
    assert [(v["revision"], v["message"]) for v in revs] == [(2, "add bass"), (1, "Created")]
    old = client.get(f"/api/projects/{doc['id']}/revisions/1").json()
    assert old["document"]["bpm"] == 120


def test_stale_save_returns_conflict(client):
    doc = create(client)["document"]
    url = f"/api/projects/{doc['id']}"
    assert client.put(url, json={"baseRevision": 1, "document": doc}).status_code == 200
    r = client.put(url, json={"baseRevision": 1, "document": doc})
    assert r.status_code == 409
    assert r.json()["detail"]["currentRevision"] == 2


def test_invalid_document_rejected_and_not_saved(client):
    doc = create(client)["document"]
    bad = {
        **doc,
        "clips": [
            {"id": "c", "trackId": "nope", "patternId": "p", "startBeat": 0, "lengthBeats": 1}
        ],
    }
    r = client.put(f"/api/projects/{doc['id']}", json={"baseRevision": 1, "document": bad})
    assert r.status_code == 422
    assert client.get(f"/api/projects/{doc['id']}").json()["revision"] == 1


def test_document_id_must_match_url(client):
    doc = create(client)["document"]
    other = create(client, name="Other")["document"]
    r = client.put(f"/api/projects/{doc['id']}", json={"baseRevision": 1, "document": other})
    assert r.status_code == 422


def test_delete_and_missing(client):
    doc = create(client)["document"]
    assert client.delete(f"/api/projects/{doc['id']}").status_code == 204
    assert client.get(f"/api/projects/{doc['id']}").status_code == 404
    assert client.get(f"/api/projects/{doc['id']}/revisions").status_code == 404
    assert client.delete(f"/api/projects/{doc['id']}").status_code == 404


def test_create_validation(client):
    assert client.post("/api/projects", json={"name": ""}).status_code == 422
    assert client.post("/api/projects", json={"name": "x", "bpm": 1}).status_code == 422


def test_oversized_body_rejected(client, monkeypatch):
    from app.config import get_settings

    doc = create(client)["document"]
    monkeypatch.setattr(get_settings(), "max_project_bytes", 10)
    r = client.put(f"/api/projects/{doc['id']}", json={"baseRevision": 1, "document": doc})
    assert r.status_code == 413


def test_create_defaults_to_starter_kit(client):
    r = client.post("/api/projects", json={"name": "Kit"})
    assert r.status_code == 201
    doc = r.json()["document"]
    roles = [t["role"] for t in doc["tracks"]]
    assert roles == ["kick", "snare", "hihat", "clap", "bass", "lead"]
    assert all(p["notes"] == [] for p in doc["patterns"])
    assert len(doc["clips"]) == len(doc["tracks"])


def test_empty_template_has_no_tracks(client):
    doc = create(client, template="empty")["document"]
    assert doc["tracks"] == [] and doc["bpm"] == 120


def test_demo_template_is_playable_and_coherent(client):
    doc = create(client, template="demo")["document"]
    assert doc["bpm"] == 140 and doc["key"] == {"root": "A", "mode": "minor"}
    by_role = {t["role"]: t for t in doc["tracks"]}
    assert {"kick", "snare", "hihat", "bass", "lead"} <= set(by_role)
    patterns = {p["id"]: p for p in doc["patterns"]}
    for clip in doc["clips"]:
        assert patterns[clip["patternId"]]["notes"], "every demo track has notes"
        assert clip["lengthBeats"] == 8
    # Bass and lead stay inside A natural minor.
    a_minor = {9, 11, 0, 2, 4, 5, 7}
    for role in ("bass", "lead"):
        clip = next(c for c in doc["clips"] if c["trackId"] == by_role[role]["id"])
        assert {n["pitch"] % 12 for n in patterns[clip["patternId"]]["notes"]} <= a_minor


def test_template_respects_time_signature(client):
    sig = {"numerator": 3, "denominator": 4}
    doc = create(client, template="starter", timeSignature=sig)["document"]
    assert all(p["lengthBeats"] == 3 for p in doc["patterns"])
    assert all(c["lengthBeats"] == 6 for c in doc["clips"])


def test_unknown_template_rejected(client):
    assert client.post("/api/projects", json={"name": "x", "template": "nope"}).status_code == 422
