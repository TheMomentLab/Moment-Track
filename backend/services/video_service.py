"""Video business logic — video registration and frame extraction."""

from pathlib import Path

import cv2

from sqlalchemy.orm import Session

from backend.db.models import Project, Video
from backend.schemas.video import VideoCreate, VideoMeta, VideoRead


def _serialize(video: Video) -> VideoRead:
    return VideoRead(
        id=video.id,
        project_id=video.project_id,
        file_path=video.file_path,
        camera_id=video.camera_id,
        fps=video.fps,
        width=video.width,
        height=video.height,
        total_frames=video.total_frames,
        duration_sec=video.duration_sec,
    )


def list_videos(db: Session, project_id: int, limit: int, offset: int) -> tuple[int, list[VideoRead]]:
    total = db.query(Video).filter(Video.project_id == project_id).count()
    rows = (
        db.query(Video)
        .filter(Video.project_id == project_id)
        .offset(offset)
        .limit(limit)
        .all()
    )
    return total, [_serialize(r) for r in rows]


def add_video(db: Session, project_id: int, body: VideoCreate) -> VideoRead | None:
    """Register a video file. Extracts metadata via cv2."""
    # Check project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        return None

    file_path = Path(body.file_path)
    if not file_path.exists():
        raise ValueError(f"File not found: {file_path}")

    cap = cv2.VideoCapture(str(file_path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {file_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    duration_sec = total_frames / fps if fps > 0 else 0.0

    video = Video(
        project_id=project_id,
        file_path=str(file_path.resolve()),
        camera_id=body.camera_id,
        fps=fps,
        width=width,
        height=height,
        total_frames=total_frames,
        duration_sec=duration_sec,
    )
    db.add(video)
    db.commit()
    db.refresh(video)
    return _serialize(video)


def get_video_meta(db: Session, video_id: int) -> VideoMeta | None:
    video = db.query(Video).filter(Video.id == video_id).first()
    if video is None:
        return None
    return VideoMeta(
        id=video.id,
        fps=video.fps,
        width=video.width,
        height=video.height,
        total_frames=video.total_frames,
        duration_sec=video.duration_sec,
        camera_id=video.camera_id,
    )


def get_frame_jpeg(db: Session, video_id: int, frame_idx: int) -> bytes | None:
    """Extract a specific frame and return as JPEG bytes."""
    video = db.query(Video).filter(Video.id == video_id).first()
    if video is None:
        return None

    if frame_idx < 0 or frame_idx >= video.total_frames:
        raise IndexError(f"frame_idx {frame_idx} out of range [0, {video.total_frames})")

    cap = cv2.VideoCapture(video.file_path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    cap.release()

    if not ret:
        raise IOError(f"Could not read frame {frame_idx}")

    success, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not success:
        raise IOError("JPEG encoding failed")

    return bytes(buf)
