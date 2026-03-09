"""Pydantic schemas for Export."""

from pydantic import BaseModel, Field


class YoloExportRequest(BaseModel):
    video_ids: list[int] | None = None
    classes: list[str] | None = None
    frame_start: int = 0
    frame_end: int | None = None
    val_split: float = Field(0.2, ge=0.0, le=1.0)
    min_detections: int = 1
    conf_threshold: float = 0.0


class MotExportRequest(BaseModel):
    video_ids: list[int] | None = None
    classes: list[str] | None = None
    frame_start: int = 0
    frame_end: int | None = None
    min_detections: int = 1
    conf_threshold: float = 0.0


class ExportResponse(BaseModel):
    output_path: str
    frame_count: int
    detection_count: int
    track_count: int | None = None


class ExportInfoResponse(BaseModel):
    export_dir: str
