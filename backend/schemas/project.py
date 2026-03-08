"""Pydantic schemas for Project entity."""

from datetime import datetime

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    classes: list[str] = Field(..., min_length=1)


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    classes: list[str] | None = Field(None, min_length=1)


class ProjectRead(BaseModel):
    id: int
    name: str
    classes: list[str]
    video_count: int = 0
    total_frames: int = 0
    annotated_frames: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
