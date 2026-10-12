import json

import pytest
from pydantic import ValidationError

from app.schemas.project import ProjectDocument, empty_project
from app.services.migrations import UnsupportedSchemaVersion, migrate_document


def doc_with(**overrides) -> dict:
    base = empty_project("Test", project_id="prj_test").model_dump(mode="json")
    base.update(overrides)
    return base


TRACK = {"id": "trk_1", "name": "Drums", "kind": "drums"}
PATTERN = {
    "id": "pat_1",
    "name": "Beat",
    "lengthBeats": 4,
    "notes": [{"id": "n_1", "pitch": 36, "startBeat": 0, "durationBeats": 0.25}],
}


def test_empty_project_round_trips_with_camel_case():
    data = empty_project("Song").model_dump(mode="json")
    assert data["schemaVersion"] == 1
    assert "timeSignature" in data and "aiHistory" in data
    assert ProjectDocument.model_validate(data).name == "Song"


def test_valid_project_with_clip_references():
    clip = {
        "id": "clp_1",
        "trackId": "trk_1",
        "patternId": "pat_1",
        "startBeat": 0,
        "lengthBeats": 4,
    }
    doc = ProjectDocument.model_validate(doc_with(tracks=[TRACK], patterns=[PATTERN], clips=[clip]))
    assert doc.clips[0].pattern_id == "pat_1"
    assert doc.patterns[0].notes[0].velocity == 100


@pytest.mark.parametrize(
    "clip, message",
    [
        ({"trackId": "missing", "patternId": "pat_1"}, "unknown track"),
        ({"trackId": "trk_1", "patternId": "missing"}, "unknown pattern"),
        ({"trackId": "trk_1"}, "exactly one"),
    ],
)
def test_dangling_or_missing_clip_references_rejected(clip, message):
    clip = {"id": "clp_1", "startBeat": 0, "lengthBeats": 4, **clip}
    with pytest.raises(ValidationError, match=message):
        ProjectDocument.model_validate(doc_with(tracks=[TRACK], patterns=[PATTERN], clips=[clip]))


def test_duplicate_ids_rejected():
    with pytest.raises(ValidationError, match="duplicate id"):
        ProjectDocument.model_validate(doc_with(tracks=[TRACK, dict(TRACK)]))


@pytest.mark.parametrize(
    "field, value",
    [("bpm", 5), ("bpm", 1000), ("name", ""), ("unknownField", 1)],
)
def test_invalid_top_level_values_rejected(field, value):
    with pytest.raises(ValidationError):
        ProjectDocument.model_validate(doc_with(**{field: value}))


def test_invalid_note_pitch_rejected():
    bad = json.loads(json.dumps(PATTERN))
    bad["notes"][0]["pitch"] = 128
    with pytest.raises(ValidationError):
        ProjectDocument.model_validate(doc_with(patterns=[bad]))


@pytest.mark.parametrize(
    "uri", ["/etc/passwd", "C:\\Windows\\x.wav", "asset://../../secret", "http://x/a.wav"]
)
def test_unsafe_asset_uris_rejected(uri):
    asset = {"id": "ast_1", "name": "a.wav", "uri": uri}
    with pytest.raises(ValidationError):
        ProjectDocument.model_validate(doc_with(assets=[asset]))


def test_migrate_rejects_future_and_invalid_versions():
    with pytest.raises(UnsupportedSchemaVersion):
        migrate_document(doc_with(schemaVersion=99))
    with pytest.raises(UnsupportedSchemaVersion):
        migrate_document(doc_with(schemaVersion="1"))
    assert migrate_document(doc_with()).id == "prj_test"


def test_shared_schema_file_is_up_to_date():
    """shared/*.schema.json must match the Pydantic models. If this fails,
    run `npm run gen:schema` from the repository root."""
    from scripts.export_schema import SCHEMAS, SHARED, render

    for name in SCHEMAS:
        assert (SHARED / name).read_text(encoding="utf-8") == render(name), name
