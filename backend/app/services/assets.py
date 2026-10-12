"""Immutable audio asset storage.

Files are stored as data/assets/<sha[:2]>/<sha256>.<ext>. The path is derived only from
the content hash, never from client input, and files are never modified, so edits and
processing can always go back to the original recording.
"""

import hashlib
import io
import logging
import re
from dataclasses import dataclass
from pathlib import Path

import soundfile as sf
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import AssetRow
from app.schemas.project import new_id, utcnow

log = logging.getLogger(__name__)

# libsndfile container -> (file extension, media type)
FORMATS = {
    "WAV": (".wav", "audio/wav"),
    "FLAC": (".flac", "audio/flac"),
    "OGG": (".ogg", "audio/ogg"),
    "MP3": (".mp3", "audio/mpeg"),
}
KINDS = ("hum", "beatbox", "vocal", "import")


class AssetError(ValueError):
    """The upload is not acceptable audio (bad format, too long, too big...)."""


class AssetNotFound(Exception):
    pass


@dataclass(frozen=True)
class AudioInfo:
    format: str
    sample_rate: int
    channels: int
    frames: int

    @property
    def duration(self) -> float:
        return self.frames / self.sample_rate


def probe(data: bytes) -> AudioInfo:
    """Parse the header with libsndfile. Raises AssetError for anything unreadable."""
    try:
        info = sf.info(io.BytesIO(data))
    except Exception as e:  # libsndfile raises a generic RuntimeError for bad data
        raise AssetError("not a readable audio file (WAV, FLAC, OGG or MP3)") from e
    if info.format not in FORMATS:
        raise AssetError(f"unsupported audio format {info.format}")
    if not (8000 <= info.samplerate <= 192_000) or not (1 <= info.channels <= 2):
        raise AssetError("audio must be mono or stereo at 8-192 kHz")
    if info.frames <= 0:
        raise AssetError("audio file is empty")
    return AudioInfo(info.format, info.samplerate, info.channels, info.frames)


def _path_for(sha: str, ext: str) -> Path:
    root = Path(get_settings().assets_dir)
    return root / sha[:2] / f"{sha}{ext}"


def _clean_name(name: str | None) -> str:
    base = Path(name or "recording").name  # strip any directory part
    base = re.sub(r"[^\w\-. ]+", "", base).strip(" .")
    return (base or "recording")[:200]


def store(db: Session, data: bytes, name: str | None, kind: str) -> AssetRow:
    settings = get_settings()
    if kind not in KINDS:
        raise AssetError(f"kind must be one of {', '.join(KINDS)}")
    if len(data) > settings.max_upload_bytes:
        raise AssetError("file too large")
    info = probe(data)
    if info.duration > settings.max_upload_seconds:
        raise AssetError(f"audio longer than {settings.max_upload_seconds:g} seconds")

    sha = hashlib.sha256(data).hexdigest()
    ext, _ = FORMATS[info.format]
    path = _path_for(sha, ext)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)  # atomic: readers never see a partial file
    row = AssetRow(
        id=new_id("ast"),
        sha256=sha,
        name=_clean_name(name),
        kind=kind,
        sample_rate=info.sample_rate,
        channels=info.channels,
        duration_seconds=round(info.duration, 4),
        size_bytes=len(data),
        created_at=utcnow(),
    )
    db.add(row)
    db.commit()
    log.info("stored asset %s (%s, %.2fs, %s)", row.id, kind, info.duration, sha[:12])
    return row


def get(db: Session, asset_id: str) -> AssetRow:
    row = db.get(AssetRow, asset_id)
    if row is None:
        raise AssetNotFound(asset_id)
    return row


def file_for(row: AssetRow) -> tuple[Path, str]:
    """Location and media type of the stored file."""
    for ext, media in FORMATS.values():
        path = _path_for(row.sha256, ext)
        if path.exists():
            return path, media
    raise AssetNotFound(f"file for {row.id} is missing")


def asset_uri(row: AssetRow) -> str:
    return f"asset://audio/{row.id}"
