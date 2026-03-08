"""Pydantic schemas for Video entity."""

from datetime import datetime

from pydantic import BaseModel, Field


class VideoCreate(BaseModel):
    file_path: str = Field(..., min_length=1)
    camera_id: str = "default"


class VideoRead(BaseModel):
    id: int
    project_id: int
    file_path: str
    camera_id: str
    fps: float
    width: int
    height: int
    total_frames: int
    duration_sec: float

    model_config = {"from_attributes": True}


class VideoMeta(BaseModel):
    id: int
    fps: float
    width: int
    height: int
    total_frames: int
    duration_sec: float
    camera_id: str

    model_config = {"from_attributes": True}
