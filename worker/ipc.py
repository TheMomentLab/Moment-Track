"""IPC - Worker <-> DB communication for progress reporting."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from types import TracebackType

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.config import settings
from backend.db.database import Base
from backend.db.models import Detection, Embedding, Identity, InferenceJob, Track, Video

log = logging.getLogger(__name__)

_worker_engine = None
_worker_session_factory = None
_MODEL_IMPORTS = (Detection, Track, Identity, Embedding)


def get_worker_db_session() -> Session:
    global _worker_engine
    global _worker_session_factory

    if _worker_session_factory is None:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        _worker_engine = create_engine(
            settings.database_url, connect_args={"check_same_thread": False}
        )
        Base.metadata.create_all(bind=_worker_engine)
        _worker_session_factory = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=_worker_engine,
        )
    return _worker_session_factory()


def get_video_path(session: Session, video_id: int) -> str:
    video = session.query(Video).filter(Video.id == video_id).first()
    if video is None:
        raise ValueError(f"Video {video_id} not found")
    return video.file_path


class JobReporter:
    def __init__(self, job_id: int):
        self.job_id: int = job_id
        self.db: Session = get_worker_db_session()
        self._cancelled: bool = False
        self._cancel_check_calls: int = 0

    def _load_job(self) -> InferenceJob:
        job = self.db.query(InferenceJob).filter(InferenceJob.id == self.job_id).first()
        if job is None:
            raise ValueError(f"InferenceJob {self.job_id} not found")
        return job

    def _commit_or_raise(self) -> None:
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    def start(self) -> None:
        job = self._load_job()
        job.status = "running"
        job.progress = 0.0
        job.error_msg = None
        job.finished_at = None
        self._commit_or_raise()

    def update_progress(self, progress: float) -> None:
        progress = max(0.0, min(1.0, float(progress)))
        job = self._load_job()
        if job.status == "cancelled":
            self._cancelled = True
            return

        job.progress = progress
        self._commit_or_raise()

    @property
    def is_cancelled(self) -> bool:
        if self._cancelled:
            return True

        self._cancel_check_calls += 1
        if self._cancel_check_calls % 10 != 0:
            return False

        try:
            job = self._load_job()
        except Exception:
            return False

        if job.status == "cancelled":
            self._cancelled = True
        return self._cancelled

    def complete(self) -> None:
        job = self._load_job()
        if job.status == "cancelled":
            self._cancelled = True
            return
        job.status = "done"
        job.progress = 1.0
        job.finished_at = datetime.now(timezone.utc)
        self._commit_or_raise()

    def fail(self, error_msg: str) -> None:
        job = self._load_job()
        if job.status == "cancelled":
            self._cancelled = True
            return
        job.status = "failed"
        job.error_msg = error_msg
        job.finished_at = datetime.now(timezone.utc)
        self._commit_or_raise()

    def close(self) -> None:
        self.db.close()

    def __enter__(self) -> JobReporter:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        try:
            if exc is not None and not self._cancelled:
                message = str(exc) or exc.__class__.__name__
                self.fail(message)
        except Exception:
            log.exception("Failed to update reporter state during cleanup")
        finally:
            self.close()
