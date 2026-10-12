"""Application settings loaded from environment variables (see ../.env.example)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="VIBESTUDIO_",
        env_file=(BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"),
        extra="ignore",
    )

    env: str = "development"
    # SQLite by default so the app runs without Docker. Set a postgresql+psycopg:// URL
    # to use PostgreSQL (docker-compose.yml provides one).
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'data' / 'vibestudio.db').as_posix()}"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    # Upper bound on a saved project document; guards against unbounded request bodies.
    max_project_bytes: int = 5 * 1024 * 1024
    # Uploaded audio (hum takes, later vocals). Stored immutably by content hash.
    assets_dir: Path = BACKEND_DIR / "data" / "assets"
    max_upload_bytes: int = 25 * 1024 * 1024
    max_upload_seconds: float = 120.0
    # Number of revisions kept per project; older ones are pruned on save.
    max_revisions_per_project: int = 200
    log_level: str = "INFO"

    # Optional LLM prompt interpreter for beat generation. "none" uses keyword rules only.
    # With "anthropic", credentials come from ANTHROPIC_API_KEY (or an `ant auth login`
    # profile), read by the Anthropic SDK itself. Never put keys in VITE_* variables.
    llm_provider: Literal["none", "anthropic"] = "none"
    llm_model: str = "claude-opus-5-5"
    llm_timeout_seconds: float = 30.0
    # Read from the environment or .env. If unset, the SDK falls back to its own sources
    # (an exported ANTHROPIC_API_KEY or an `ant auth login` profile). Never logged.
    anthropic_api_key: SecretStr | None = Field(
        None, validation_alias=AliasChoices("ANTHROPIC_API_KEY", "VIBESTUDIO_ANTHROPIC_API_KEY")
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
