"""SQLite database connection and session management."""

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


# Default DB path: ~/.mt_track/mt_track.db
_default_db_dir = Path.home() / ".mt_track"
_db_url = os.environ.get("MT_DB_URL", f"sqlite:///{_default_db_dir / 'mt_track.db'}")

engine = create_engine(_db_url, connect_args={"check_same_thread": False}, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    """Create all tables (if not exist)."""
    from backend.db import models  # noqa: F401

    _default_db_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI dependency: yields a DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
