from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import AssetRow
from app.db.session import get_db
from app.schemas.project import Model
from app.services import assets as svc

router = APIRouter(prefix="/api/assets", tags=["assets"])


class AssetResponse(Model):
    id: str
    uri: str
    name: str
    kind: str
    sha256: str
    sample_rate: int
    channels: int
    duration_seconds: float
    size_bytes: int
    created_at: datetime


def asset_response(row: AssetRow) -> AssetResponse:
    return AssetResponse(
        id=row.id,
        uri=svc.asset_uri(row),
        name=row.name,
        kind=row.kind,
        sha256=row.sha256,
        sample_rate=row.sample_rate,
        channels=row.channels,
        duration_seconds=row.duration_seconds,
        size_bytes=row.size_bytes,
        created_at=row.created_at,
    )


async def _read_limited(request: Request, limit: int) -> bytes:
    """Read the raw body, stopping as soon as it exceeds `limit` bytes."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "file too large")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "file too large")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
async def upload(
    request: Request,
    name: str = Query("recording.wav", max_length=255),
    kind: Literal["hum", "beatbox", "vocal", "import"] = Query("import"),
    db: Session = Depends(get_db),
):
    """Upload one audio file as the raw request body (not multipart)."""
    data = await _read_limited(request, get_settings().max_upload_bytes)
    try:
        row = svc.store(db, data, name, kind)
    except svc.AssetError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
    return asset_response(row)


@router.get("/{asset_id}", response_model=AssetResponse)
def metadata(asset_id: str, db: Session = Depends(get_db)):
    try:
        return asset_response(svc.get(db, asset_id))
    except svc.AssetNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "asset not found") from None


@router.get("/{asset_id}/audio")
def audio(asset_id: str, db: Session = Depends(get_db)):
    try:
        path, media = svc.file_for(svc.get(db, asset_id))
    except svc.AssetNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "asset not found") from None
    return FileResponse(path, media_type=media)
