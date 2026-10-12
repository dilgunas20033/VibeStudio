"""Project document migrations.

Stored documents carry `schemaVersion`. When the schema changes incompatibly,
bump PROJECT_SCHEMA_VERSION and register a step here that upgrades a raw dict
from version N to N+1. Documents are migrated on load, so old projects keep
opening. Database table changes use Alembic instead (see backend/alembic).
"""

from collections.abc import Callable

from app.schemas.project import PROJECT_SCHEMA_VERSION, ProjectDocument

# from_version -> function returning a dict at from_version + 1
_STEPS: dict[int, Callable[[dict], dict]] = {}


class UnsupportedSchemaVersion(ValueError):
    pass


def migrate_document(data: dict) -> ProjectDocument:
    version = data.get("schemaVersion")
    if not isinstance(version, int) or version < 1:
        raise UnsupportedSchemaVersion(f"invalid schemaVersion: {version!r}")
    if version > PROJECT_SCHEMA_VERSION:
        raise UnsupportedSchemaVersion(
            f"project uses schema {version}, this build supports up to {PROJECT_SCHEMA_VERSION}"
        )
    while version < PROJECT_SCHEMA_VERSION:
        data = _STEPS[version](dict(data))
        version += 1
        data["schemaVersion"] = version
    return ProjectDocument.model_validate(data)
