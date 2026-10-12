import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.project import Id, Model, NoteName
from app.services import assets
from app.transcription.beatbox import transcribe_beatbox
from app.transcription.melody import load_audio, transcribe_melody

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/transcribe", tags=["transcription"])


class TranscribeRequest(Model):
    asset_id: Id


class DetectedNoteOut(Model):
    start: float
    end: float
    pitch: int
    pitch_cents: float
    confidence: float
    velocity: int


class TempoOut(Model):
    bpm: float
    confidence: float
    alternatives: list[float]


class KeyOut(Model):
    root: NoteName
    mode: str
    confidence: float


class MelodyTranscriptionOut(Model):
    asset_id: str
    method: str = "pyin-v1"
    duration: float
    tuning_cents: float
    notes: list[DetectedNoteOut]
    tempo: TempoOut
    key: KeyOut
    curve_times: list[float]
    curve_midi: list[float]
    warnings: list[str]


def _load(db: Session, asset_id: str):
    try:
        row = assets.get(db, asset_id)
        path, _ = assets.file_for(row)
    except assets.AssetNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "asset not found") from None
    try:
        return row, *load_audio(path.read_bytes())
    except Exception as e:
        log.exception("could not decode asset %s", row.id)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "audio could not be decoded"
        ) from e


@router.post("/melody", response_model=MelodyTranscriptionOut)
def melody(body: TranscribeRequest, db: Session = Depends(get_db)) -> MelodyTranscriptionOut:
    """Transcribe a stored recording of humming or singing into notes (monophonic).

    Runs pYIN pitch tracking; the first call after start-up is slower while numba compiles.
    """
    row, y, sr = _load(db, body.asset_id)
    t = transcribe_melody(y, sr)
    return MelodyTranscriptionOut(
        asset_id=row.id,
        duration=t.duration,
        tuning_cents=t.tuning_cents,
        notes=[DetectedNoteOut(**n.__dict__) for n in t.notes],
        tempo=TempoOut(
            bpm=t.tempo.bpm, confidence=t.tempo.confidence, alternatives=list(t.tempo.alternatives)
        ),
        key=KeyOut(root=t.key.root, mode=t.key.mode, confidence=t.key.confidence),
        curve_times=t.curve_times,
        curve_midi=t.curve_midi,
        warnings=t.warnings,
    )


class DrumHitOut(Model):
    time: float
    drum: str
    confidence: float
    velocity: int
    centroid_hz: float
    low_ratio: float
    high_ratio: float
    decay_s: float


class BeatboxTranscriptionOut(Model):
    asset_id: str
    method: str = "onset-rules-v1"
    duration: float
    hits: list[DrumHitOut]
    tempo: TempoOut
    warnings: list[str]


@router.post("/beatbox", response_model=BeatboxTranscriptionOut)
def beatbox(body: TranscribeRequest, db: Session = Depends(get_db)) -> BeatboxTranscriptionOut:
    """Transcribe a stored beatbox recording into classified drum hits."""
    row, y, sr = _load(db, body.asset_id)
    t = transcribe_beatbox(y, sr)
    return BeatboxTranscriptionOut(
        asset_id=row.id,
        duration=t.duration,
        hits=[DrumHitOut(**h.__dict__) for h in t.hits],
        tempo=TempoOut(
            bpm=t.tempo.bpm, confidence=t.tempo.confidence, alternatives=list(t.tempo.alternatives)
        ),
        warnings=t.warnings,
    )
