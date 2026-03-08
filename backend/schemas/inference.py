"""Pydantic schemas for Inference entities."""

from datetime import datetime

from pydantic import BaseModel, Field


class DetectRequest(BaseModel):
    video_id: int
    frame_start: int = 0
    frame_end: int | None = None
    model_path: str
    classes: list[str] | None = None
    conf_threshold: float = 0.5
    iou_threshold: float = 0.45


class TrackRequest(BaseModel):
    video_id: int
    frame_start: int = 0
    frame_end: int | None = None
    track_thresh: float = 0.5
    match_thresh: float = 0.8
    track_buffer: int = 30


class EmbedRequest(BaseModel):
    video_id: int
    model_path: str
    batch_size: int = 64


class JobResponse(BaseModel):
    job_id: int
    status: str


class JobRead(BaseModel):
    id: int
    job_type: str
    status: str
    progress: float
    error_msg: str | None
    created_at: datetime
    finished_at: datetime | None

    model_config = {"from_attributes": True}
