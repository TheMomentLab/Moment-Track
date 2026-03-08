"""Moment Track — FastAPI application entry point."""

from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from backend.db.database import init_db
from backend.routers import annotations, export, inference, projects, videos


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: initialize DB on startup."""
    init_db()
    yield


app = FastAPI(
    title="Moment Track",
    description="Video annotation API for MOT/ReID dataset creation",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(projects.router, prefix="/api/v1", tags=["projects"])
app.include_router(videos.router, prefix="/api/v1", tags=["videos"])
app.include_router(annotations.router, prefix="/api/v1", tags=["annotations"])
app.include_router(inference.router, prefix="/api/v1", tags=["inference"])
app.include_router(export.router, prefix="/api/v1", tags=["export"])


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve React frontend (must be after API routes)
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        return FileResponse(str(_DIST / "index.html"))
