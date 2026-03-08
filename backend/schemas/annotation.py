"""Pydantic schemas for Detection, Track, Identity entities."""

from datetime import datetime

from pydantic import BaseModel, Field


# --- Detection ---


class DetectionCreate(BaseModel):
    frame_idx: int = Field(..., ge=0)
    x: float
    y: float
    w: float = Field(..., gt=0)
    h: float = Field(..., gt=0)
    class_name: str
    track_id: int | None = None
    is_keyframe: bool = True


class DetectionUpdate(BaseModel):
    x: float | None = None
    y: float | None = None
    w: float | None = Field(None, gt=0)
    h: float | None = Field(None, gt=0)
    class_name: str | None = None
    is_keyframe: bool | None = None


class DetectionRead(BaseModel):
    id: int
    track_id: int | None
    video_id: int
    frame_idx: int
    x: float
    y: float
    w: float
    h: float
    confidence: float | None
    class_name: str
    is_keyframe: bool
    is_interpolated: bool
    source: str

    model_config = {"from_attributes": True}


class InterpolateRequest(BaseModel):
    track_id: int
    frame_start: int = Field(..., ge=0)
    frame_end: int = Field(..., ge=0)


class InterpolateResponse(BaseModel):
    created_count: int
    detections: list[DetectionRead]


# --- Track ---


class TrackRead(BaseModel):
    id: int
    identity_id: int | None
    video_id: int
    start_frame: int
    end_frame: int
    detection_count: int = 0
    source: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TrackUpdate(BaseModel):
    identity_id: int | None = None


class TrackMergeRequest(BaseModel):
    track_id_a: int
    track_id_b: int


class TrackSplitRequest(BaseModel):
    split_frame: int


class TrackSplitResponse(BaseModel):
    track_a: TrackRead
    track_b: TrackRead


# --- Identity ---


class IdentityCreate(BaseModel):
    class_name: str
    label: str | None = None


class IdentityUpdate(BaseModel):
    label: str | None = None
    class_name: str | None = None


class IdentityRead(BaseModel):
    id: int
    project_id: int
    label: str | None
    class_name: str
    track_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class IdentityMergeRequest(BaseModel):
    identity_id_a: int
    identity_id_b: int


class IdentityMergeResponse(BaseModel):
    merged_identity: IdentityRead
    moved_track_count: int


class CropItem(BaseModel):
    detection_id: int
    video_id: int
    frame_idx: int
    track_id: int | None
    bbox: dict  # {x, y, w, h}
    anomaly_score: float | None = None
