import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import Field
from sqlalchemy.orm import Session

from app.api.projects import limit_body, project_response
from app.db.session import get_db
from app.generation.composer import compose
from app.generation.params import GenerationPlan, GenerationRequest
from app.generation.resolve import resolve_plan
from app.schemas.api import ProjectResponse
from app.schemas.project import AudioAsset, Id, Model, ProjectDocument
from app.services import assets
from app.services import projects as svc
from app.services.midi import to_midi

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["generation"])


class GenerateResponse(Model):
    plan: GenerationPlan
    project: ProjectResponse


class MidiExportRequest(Model):
    document: ProjectDocument
    track_ids: list[Id] | None = Field(None, max_length=256)


@router.post("/generate/plan", response_model=GenerationPlan)
def preview_plan(body: GenerationRequest) -> GenerationPlan:
    """Interpret the request without composing, so the user can check the reading first."""
    return resolve_plan(body)


@router.post("/generate", response_model=GenerateResponse, status_code=status.HTTP_201_CREATED)
def generate(body: GenerationRequest, db: Session = Depends(get_db)) -> GenerateResponse:
    plan = resolve_plan(body)
    recordings = []
    sources = [x.source_asset_id for x in (body.melody, body.drums) if x and x.source_asset_id]
    for asset_id in dict.fromkeys(sources):
        # Keep a reference to the original recording in the project (never modified).
        try:
            row = assets.get(db, asset_id)
        except assets.AssetNotFound:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "unknown source asset"
            ) from None
        recordings.append(
            AudioAsset(
                id=row.id, name=row.name, uri=assets.asset_uri(row), sha256=row.sha256,
                sample_rate=row.sample_rate, channels=row.channels,
                duration_seconds=row.duration_seconds,
            )
        )  # fmt: skip
    doc = compose(plan, body.prompt, melody=body.melody, assets=recordings, drums=body.drums)
    log.info(
        "generated %s: %s %s %sbpm %d bars seed=%d interpreter=%s",
        doc.id, plan.genre, plan.mood, plan.bpm, plan.bars, plan.seed, plan.interpreter,
    )  # fmt: skip
    row = svc.create_project(
        db, doc, message=f"Generated ({plan.genre}, {plan.mood}, seed {plan.seed})"
    )
    return GenerateResponse(plan=plan, project=project_response(row))


def _filename(name: str, ext: str) -> str:
    return (re.sub(r"[^\w\- ]+", "", name).strip() or "vibestudio") + ext


@router.post("/export/midi", dependencies=[Depends(limit_body)])
def export_midi(body: MidiExportRequest) -> Response:
    """Export the given document (usually the unsaved state on screen) as a .mid file."""
    known = {t.id for t in body.document.tracks}
    if body.track_ids is not None and not set(body.track_ids) <= known:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "unknown track id")
    data = to_midi(body.document, body.track_ids)
    return Response(
        content=data,
        media_type="audio/midi",
        headers={
            "Content-Disposition": f'attachment; filename="{_filename(body.document.name, ".mid")}"'
        },
    )
