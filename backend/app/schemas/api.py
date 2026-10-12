"""Request/response models for the HTTP API (distinct from the stored document)."""

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.project import Model, MusicalKey, ProjectDocument, TimeSignature


class HealthResponse(Model):
    status: str
    version: str
    project_schema_version: int
    database: str


class ProjectCreate(Model):
    name: str = Field(min_length=1, max_length=120)
    template: Literal["empty", "starter", "demo"] = Field(
        "starter",
        description="empty: no tracks. starter: drum kit, bass and lead with empty patterns. "
        "demo: a playable two-bar beat.",
    )
    bpm: float | None = Field(None, ge=20.0, le=400.0, description="Defaults per template")
    key: MusicalKey | None = None
    time_signature: TimeSignature | None = None


class ProjectSummary(Model):
    id: str
    name: str
    bpm: float
    revision: int
    track_count: int
    created_at: datetime
    updated_at: datetime


class ProjectResponse(Model):
    revision: int
    created_at: datetime
    updated_at: datetime
    document: ProjectDocument


class ProjectSave(Model):
    base_revision: int = Field(
        ge=1, description="Revision the client edited. A mismatch returns 409 Conflict."
    )
    message: str | None = Field(None, max_length=500)
    document: ProjectDocument


class RevisionSummary(Model):
    revision: int
    message: str | None
    created_at: datetime


class RevisionResponse(RevisionSummary):
    document: ProjectDocument
