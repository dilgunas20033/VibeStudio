"""Project persistence logic, kept free of HTTP concerns."""

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import ProjectRevisionRow, ProjectRow
from app.schemas.project import ProjectDocument, utcnow


class ProjectNotFound(Exception):
    pass


class RevisionConflict(Exception):
    def __init__(self, current: int):
        super().__init__(f"project is at revision {current}")
        self.current = current


def _dump(doc: ProjectDocument) -> dict:
    return doc.model_dump(mode="json", by_alias=True)


def list_projects(db: Session) -> list[ProjectRow]:
    return list(db.scalars(select(ProjectRow).order_by(ProjectRow.updated_at.desc())))


def get_project(db: Session, project_id: str) -> ProjectRow:
    row = db.get(ProjectRow, project_id)
    if row is None:
        raise ProjectNotFound(project_id)
    return row


def create_project(db: Session, doc: ProjectDocument, message: str = "Created") -> ProjectRow:
    now = utcnow()
    data = _dump(doc)
    row = ProjectRow(
        id=doc.id,
        name=doc.name,
        schema_version=doc.schema_version,
        revision=1,
        document=data,
        created_at=now,
        updated_at=now,
    )
    row.revisions.append(
        ProjectRevisionRow(revision=1, message=message[:500], document=data, created_at=now)
    )
    db.add(row)
    db.commit()
    return row


def save_project(
    db: Session, project_id: str, doc: ProjectDocument, base_revision: int, message: str | None
) -> ProjectRow:
    """Store a new revision.

    Optimistic concurrency: the client sends the revision it edited, so two tabs
    cannot silently overwrite each other's work.
    """
    row = get_project(db, project_id)
    if doc.id != project_id:
        raise ValueError("document id does not match project id")
    if base_revision != row.revision:
        raise RevisionConflict(row.revision)

    now = utcnow()
    data = _dump(doc)
    row.revision += 1
    row.name = doc.name
    row.schema_version = doc.schema_version
    row.document = data
    row.updated_at = now
    db.add(
        ProjectRevisionRow(
            project_id=row.id, revision=row.revision, message=message, document=data, created_at=now
        )
    )
    keep = get_settings().max_revisions_per_project
    if row.revision > keep:
        db.execute(
            delete(ProjectRevisionRow).where(
                ProjectRevisionRow.project_id == row.id,
                ProjectRevisionRow.revision <= row.revision - keep,
            )
        )
    db.commit()
    return row


def delete_project(db: Session, project_id: str) -> None:
    row = get_project(db, project_id)
    db.delete(row)
    db.commit()


def list_revisions(db: Session, project_id: str) -> list[ProjectRevisionRow]:
    get_project(db, project_id)
    return list(
        db.scalars(
            select(ProjectRevisionRow)
            .where(ProjectRevisionRow.project_id == project_id)
            .order_by(ProjectRevisionRow.revision.desc())
        )
    )


def get_revision(db: Session, project_id: str, revision: int) -> ProjectRevisionRow:
    rev = db.scalar(
        select(ProjectRevisionRow).where(
            ProjectRevisionRow.project_id == project_id, ProjectRevisionRow.revision == revision
        )
    )
    if rev is None:
        raise ProjectNotFound(f"{project_id}@{revision}")
    return rev
