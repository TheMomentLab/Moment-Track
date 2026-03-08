"""SQLAlchemy ORM models for Moment Track."""

from datetime import datetime

from sqlalchemy import (
    BLOB,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.db.database import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    classes: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    videos: Mapped[list["Video"]] = relationship(back_populates="project", cascade="all, delete")
    identities: Mapped[list["Identity"]] = relationship(
        back_populates="project", cascade="all, delete"
    )
    inference_jobs: Mapped[list["InferenceJob"]] = relationship(
        back_populates="project", cascade="all, delete"
    )


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    camera_id: Mapped[str] = mapped_column(String, nullable=False, default="default")
    fps: Mapped[float] = mapped_column(Float, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    total_frames: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_sec: Mapped[float] = mapped_column(Float, nullable=False)

    project: Mapped["Project"] = relationship(back_populates="videos")
    tracks: Mapped[list["Track"]] = relationship(back_populates="video", cascade="all, delete")
    detections: Mapped[list["Detection"]] = relationship(
        back_populates="video", cascade="all, delete"
    )
    inference_jobs: Mapped[list["InferenceJob"]] = relationship(
        back_populates="video", cascade="all, delete"
    )


class Identity(Base):
    __tablename__ = "identities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    class_name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="identities")
    tracks: Mapped[list["Track"]] = relationship(back_populates="identity")


class Track(Base):
    __tablename__ = "tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    identity_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("identities.id"), nullable=True
    )
    video_id: Mapped[int] = mapped_column(Integer, ForeignKey("videos.id"), nullable=False)
    start_frame: Mapped[int] = mapped_column(Integer, nullable=False)
    end_frame: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False, default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    identity: Mapped["Identity | None"] = relationship(back_populates="tracks")
    video: Mapped["Video"] = relationship(back_populates="tracks")
    detections: Mapped[list["Detection"]] = relationship(
        back_populates="track", cascade="all, delete"
    )


class Detection(Base):
    __tablename__ = "detections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    track_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("tracks.id"), nullable=True
    )
    video_id: Mapped[int] = mapped_column(Integer, ForeignKey("videos.id"), nullable=False)
    frame_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    w: Mapped[float] = mapped_column(Float, nullable=False)
    h: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    class_name: Mapped[str] = mapped_column(String, nullable=False)
    is_keyframe: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_interpolated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source: Mapped[str] = mapped_column(String, nullable=False, default="manual")

    track: Mapped["Track | None"] = relationship(back_populates="detections")
    video: Mapped["Video"] = relationship(back_populates="detections")
    embedding: Mapped["Embedding | None"] = relationship(
        back_populates="detection", uselist=False, cascade="all, delete"
    )


class Embedding(Base):
    __tablename__ = "embeddings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    detection_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("detections.id"), unique=True, nullable=False
    )
    vector: Mapped[bytes] = mapped_column(BLOB, nullable=False)
    model_name: Mapped[str] = mapped_column(String, nullable=False)

    detection: Mapped["Detection"] = relationship(back_populates="embedding")


class InferenceJob(Base):
    __tablename__ = "inference_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id"), nullable=False)
    video_id: Mapped[int] = mapped_column(Integer, ForeignKey("videos.id"), nullable=False)
    job_type: Mapped[str] = mapped_column(String, nullable=False)  # detect / track / embed
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    params: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    project: Mapped["Project"] = relationship(back_populates="inference_jobs")
    video: Mapped["Video"] = relationship(back_populates="inference_jobs")
