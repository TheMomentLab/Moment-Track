"""Inference router — AI worker job management."""

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.config import settings
from backend.db.database import get_db
from backend.schemas.inference import (
    DetectRequest,
    EmbedRequest,
    JobRead,
    JobResponse,
    TrackRequest,
)
from backend.services import worker_client

router = APIRouter()


def _job_read(job) -> JobRead:
    return JobRead(
        id=job.id,
        job_type=job.job_type,
        status=job.status,
        progress=job.progress,
        error_msg=job.error_msg,
        created_at=job.created_at,
        finished_at=job.finished_at,
    )


@router.post("/inference/detect", response_model=JobResponse, status_code=201)
def start_detect(body: DetectRequest, db: Session = Depends(get_db)):
    """Start a YOLO detection job."""
    try:
        job = worker_client.submit_detect(db, body)
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
    return JobResponse(job_id=job.id, status=job.status)


@router.post("/inference/track", response_model=JobResponse, status_code=201)
def start_track(body: TrackRequest, db: Session = Depends(get_db)):
    """Start a ByteTrack tracking job."""
    try:
        job = worker_client.submit_track(db, body)
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
    return JobResponse(job_id=job.id, status=job.status)


@router.post("/inference/embed", response_model=JobResponse, status_code=201)
def start_embed(body: EmbedRequest, db: Session = Depends(get_db)):
    """Start a ReID embedding job."""
    try:
        job = worker_client.submit_embed(db, body)
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
    return JobResponse(job_id=job.id, status=job.status)


@router.get("/inference/jobs/{job_id}", response_model=JobRead)
def get_job(job_id: int, db: Session = Depends(get_db)):
    """Get job status."""
    job = worker_client.get_job(db, job_id)
    if job is None:
        raise HTTPException(404, detail="Job not found")
    return _job_read(job)


@router.get("/projects/{project_id}/inference/jobs", response_model=list[JobRead])
def list_jobs(project_id: int, db: Session = Depends(get_db)):
    """List recent inference jobs for a project."""
    jobs = worker_client.list_jobs(db, project_id)
    return [_job_read(j) for j in jobs]


@router.delete("/inference/jobs/{job_id}", status_code=204)
def cancel_job(job_id: int, db: Session = Depends(get_db)):
    """Cancel a running job."""
    ok = worker_client.cancel_job(db, job_id)
    if not ok:
        raise HTTPException(404, detail="Job not found")


@router.get("/inference/jobs/{job_id}/stream")
def stream_job_progress(job_id: int, db: Session = Depends(get_db)):
    """SSE stream for job progress (polls DB every second)."""
    import time

    def generate():
        while True:
            job = worker_client.get_job(db, job_id)
            if job is None:
                yield f"data: {json.dumps({'error': 'not found'})}\n\n"
                break
            payload = {
                "job_id": job.id,
                "status": job.status,
                "progress": job.progress,
                "error_msg": job.error_msg,
            }
            yield f"data: {json.dumps(payload)}\n\n"
            if job.status in ("done", "failed", "cancelled"):
                break
            time.sleep(settings.sse_poll_interval)

    return StreamingResponse(generate(), media_type="text/event-stream")
