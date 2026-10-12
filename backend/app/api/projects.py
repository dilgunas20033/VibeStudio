from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import ProjectRow
from app.db.session import get_db
from app.schemas.api import (
    ProjectCreate,
    ProjectResponse,
    ProjectSave,
    ProjectSummary,
    RevisionResponse,
    RevisionSummary,
)
from app.services import projects as svc
from app.services.migrations import migrate_document
from app.services.templates import build_project

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"project '{what}' not found")


def project_response(row: ProjectRow) -> ProjectResponse:
    return ProjectResponse(
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
        document=migrate_document(row.document),
    )


def limit_body(request: Request) -> None:
    length = request.headers.get("content-length")
    if length is not None and length.isdigit() and int(length) > get_settings().max_project_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "project document too large")


@router.get("", response_model=list[ProjectSummary])
def list_projects(db: Session = Depends(get_db)):
    return [
        ProjectSummary(
            id=r.id,
            name=r.name,
            bpm=r.document.get("bpm", 120),
            revision=r.revision,
            track_count=len(r.document.get("tracks", [])),
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in svc.list_projects(db)
    ]


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    doc = build_project(
        body.name, body.template, bpm=body.bpm, key=body.key, time_signature=body.time_signature
    )
    return project_response(svc.create_project(db, doc))


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str, db: Session = Depends(get_db)):
    try:
        return project_response(svc.get_project(db, project_id))
    except svc.ProjectNotFound:
        raise _not_found(project_id) from None


@router.put("/{project_id}", response_model=ProjectResponse, dependencies=[Depends(limit_body)])
def save_project(project_id: str, body: ProjectSave, db: Session = Depends(get_db)):
    try:
        row = svc.save_project(db, project_id, body.document, body.base_revision, body.message)
    except svc.ProjectNotFound:
        raise _not_found(project_id) from None
    except svc.RevisionConflict as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"message": "project was modified elsewhere", "currentRevision": e.current},
        ) from None
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
    return project_response(row)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    try:
        svc.delete_project(db, project_id)
    except svc.ProjectNotFound:
        raise _not_found(project_id) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/revisions", response_model=list[RevisionSummary])
def list_revisions(project_id: str, db: Session = Depends(get_db)):
    try:
        revs = svc.list_revisions(db, project_id)
    except svc.ProjectNotFound:
        raise _not_found(project_id) from None
    return [
        RevisionSummary(revision=r.revision, message=r.message, created_at=r.created_at)
        for r in revs
    ]


@router.get("/{project_id}/revisions/{revision}", response_model=RevisionResponse)
def get_revision(project_id: str, revision: int, db: Session = Depends(get_db)):
    try:
        r = svc.get_revision(db, project_id, revision)
    except svc.ProjectNotFound:
        raise _not_found(f"{project_id}@{revision}") from None
    return RevisionResponse(
        revision=r.revision,
        message=r.message,
        created_at=r.created_at,
        document=migrate_document(r.document),
    )
