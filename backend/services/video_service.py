"""Video business logic — video registration and frame extraction."""

from pathlib import Path
from uuid import uuid4

import cv2
from fastapi import UploadFile

from sqlalchemy.orm import Session

from backend.config import settings
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


def _get_project(db: Session, project_id: int) -> Project | None:
    return db.query(Project).filter(Project.id == project_id).first()


def _read_video_metadata(file_path: Path) -> tuple[float, int, int, int, float]:
    cap = cv2.VideoCapture(str(file_path))
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {file_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    duration_sec = total_frames / fps if fps > 0 else 0.0
    return fps, width, height, total_frames, duration_sec


def _create_video_row(
    db: Session,
    project_id: int,
    file_path: Path,
    camera_id: str,
) -> VideoRead:
    fps, width, height, total_frames, duration_sec = _read_video_metadata(file_path)

    video = Video(
        project_id=project_id,
        file_path=str(file_path.resolve()),
        camera_id=camera_id,
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
    project = _get_project(db, project_id)
    if project is None:
        return None

    file_path = Path(body.file_path)
    if not file_path.exists():
        raise ValueError(f"File not found: {file_path}")
    return _create_video_row(db, project_id, file_path, body.camera_id)


async def upload_video_file(
    db: Session,
    project_id: int,
    upload: UploadFile,
    camera_id: str,
) -> VideoRead | None:
    project = _get_project(db, project_id)
    if project is None:
        return None

    original_name = Path(upload.filename or "video.mp4")
    suffix = original_name.suffix.lower()
    if suffix not in {".mp4", ".avi", ".mov", ".mkv"}:
        raise ValueError(f"Unsupported file type: {suffix or '<none>'}")

    uploads_dir = settings.export_root / str(project_id) / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    stored_path = uploads_dir / f"{uuid4().hex}{suffix}"

    with stored_path.open("wb") as handle:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)

    await upload.close()

    try:
        return _create_video_row(db, project_id, stored_path, camera_id)
    except Exception:
        stored_path.unlink(missing_ok=True)
        raise


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

    success, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, settings.jpeg_quality])
    if not success:
        raise IOError("JPEG encoding failed")

    return bytes(buf)
