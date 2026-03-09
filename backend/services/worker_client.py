"""Worker client — manages InferenceJob records and simulates worker dispatch.

Since the GPU worker is a separate optional process, this module:
  - Creates/updates InferenceJob rows in the DB
  - Attempts to communicate with a worker process if available (fire-and-forget HTTP)
  - Falls back gracefully if no worker is running (job stays in 'pending' state)
"""

import json
import logging
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from backend.config import settings
from backend.db.models import InferenceJob
from backend.schemas.inference import DetectRequest, EmbedRequest, TrackRequest

log = logging.getLogger(__name__)


def _create_job(db: Session, project_id: int, video_id: int, job_type: str, params: dict) -> InferenceJob:
    job = InferenceJob(
        project_id=project_id,
        video_id=video_id,
        job_type=job_type,
        status="pending",
        params=json.dumps(params),
        progress=0.0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def _dispatch(job_id: int, payload: dict) -> None:
    """Fire-and-forget HTTP POST to worker. Swallows all errors."""
    try:
        httpx.post(
            f"{settings.worker_url}/run",
            json={"job_id": job_id, **payload},
            timeout=settings.worker_timeout,
        )
    except Exception:
        log.debug("Worker not available (job %d stays pending)", job_id)


def submit_detect(db: Session, body: DetectRequest) -> InferenceJob:
    # resolve project_id from video
    from backend.db.models import Video
    video = db.query(Video).filter(Video.id == body.video_id).first()
    if video is None:
        raise ValueError(f"Video {body.video_id} not found")
    params = body.model_dump()
    job = _create_job(db, video.project_id, body.video_id, "detect", params)
    _dispatch(job.id, {"type": "detect", **params})
    return job


def submit_track(db: Session, body: TrackRequest) -> InferenceJob:
    from backend.db.models import Video
    video = db.query(Video).filter(Video.id == body.video_id).first()
    if video is None:
        raise ValueError(f"Video {body.video_id} not found")
    params = body.model_dump()
    job = _create_job(db, video.project_id, body.video_id, "track", params)
    _dispatch(job.id, {"type": "track", **params})
    return job


def submit_embed(db: Session, body: EmbedRequest) -> InferenceJob:
    from backend.db.models import Video
    video = db.query(Video).filter(Video.id == body.video_id).first()
    if video is None:
        raise ValueError(f"Video {body.video_id} not found")
    params = body.model_dump()
    job = _create_job(db, video.project_id, body.video_id, "embed", params)
    _dispatch(job.id, {"type": "embed", **params})
    return job


def get_job(db: Session, job_id: int) -> InferenceJob | None:
    return db.query(InferenceJob).filter(InferenceJob.id == job_id).first()


def list_jobs(db: Session, project_id: int, limit: int = 20) -> list[InferenceJob]:
    return (
        db.query(InferenceJob)
        .filter(InferenceJob.project_id == project_id)
        .order_by(InferenceJob.created_at.desc())
        .limit(limit)
        .all()
    )


def cancel_job(db: Session, job_id: int) -> bool:
    job = db.query(InferenceJob).filter(InferenceJob.id == job_id).first()
    if job is None:
        return False
    if job.status in ("pending", "running"):
        job.status = "cancelled"
        job.finished_at = datetime.utcnow()
        db.commit()
    return True
