"""Centralized application settings.

All deployment-specific values consolidated here. Override any setting
via environment variable with the ``MT_`` prefix, or place them in a
``.env`` file at the project root.

Examples::

    MT_PORT=9000
    MT_CORS_ORIGINS='["http://localhost:5173"]'
    MT_WORKER_URL=http://gpu-host:8001
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Server ──────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000

    # ── Data & Database ─────────────────────────────────────
    data_dir: Path = Path.home() / ".mt_track"
    db_url: str = ""

    # ── CORS ────────────────────────────────────────────────
    cors_origins: list[str] = ["*"]

    # ── API ─────────────────────────────────────────────────
    api_prefix: str = "/api/v1"

    # ── Frontend static files ───────────────────────────────
    frontend_dist: Path = _PROJECT_ROOT / "frontend" / "dist"

    # ── GPU Worker ──────────────────────────────────────────
    worker_url: str = "http://127.0.0.1:8001"
    worker_timeout: float = 2.0
    worker_host: str = "0.0.0.0"
    worker_port: int = 8001

    # ── Video encoding ──────────────────────────────────────
    jpeg_quality: int = 85

    # ── SSE ─────────────────────────────────────────────────
    sse_poll_interval: float = 1.0

    # ── Computed paths ──────────────────────────────────────

    @property
    def database_url(self) -> str:
        """SQLAlchemy connection string."""
        if self.db_url:
            return self.db_url
        return f"sqlite:///{self.data_dir / 'mt_track.db'}"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "mt_track.db"

    @property
    def export_root(self) -> Path:
        return self.data_dir / "projects"

    @property
    def snapshots_dir(self) -> Path:
        return self.data_dir / "snapshots"


settings = Settings()
