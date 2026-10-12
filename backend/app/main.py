import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app import __version__
from app.api.assets import router as assets_router
from app.api.generate import router as generate_router
from app.api.projects import router as projects_router
from app.api.transcribe import router as transcribe_router
from app.config import get_settings
from app.db.session import engine
from app.schemas.api import HealthResponse
from app.schemas.project import PROJECT_SCHEMA_VERSION, ProjectDocument

settings = get_settings()
logging.basicConfig(
    level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("vibestudio")

app = FastAPI(title="VibeStudio API", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(projects_router)
app.include_router(generate_router)
app.include_router(assets_router)
app.include_router(transcribe_router)


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:
        log.exception("database health check failed")
        db_status = "error"
    return HealthResponse(
        status="ok" if db_status == "ok" else "degraded",
        version=__version__,
        project_schema_version=PROJECT_SCHEMA_VERSION,
        database=db_status,
    )


@app.get("/api/schema/project", tags=["system"])
def project_schema() -> dict:
    """JSON Schema of the project document. The frontend generates its types from it."""
    return ProjectDocument.model_json_schema(by_alias=True, mode="serialization")
