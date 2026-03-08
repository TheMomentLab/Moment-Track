"""Projects router — CRUD for projects."""

import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.db.database import get_db
from backend.schemas.common import PaginatedResponse
from backend.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate
from backend.services import project_service

router = APIRouter()


@router.get("/projects", response_model=PaginatedResponse[ProjectRead])
def list_projects(
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    total, items = project_service.list_projects(db, limit, offset)
    return PaginatedResponse(total=total, items=items)


@router.post("/projects", response_model=ProjectRead, status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    return project_service.create_project(db, body)


@router.get("/projects/{project_id}", response_model=ProjectRead)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = project_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(404, detail="Project not found")
    return project


@router.patch("/projects/{project_id}", response_model=ProjectRead)
def update_project(project_id: int, body: ProjectUpdate, db: Session = Depends(get_db)):
    project = project_service.update_project(db, project_id, body)
    if project is None:
        raise HTTPException(404, detail="Project not found")
    return project


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    ok = project_service.delete_project(db, project_id)
    if not ok:
        raise HTTPException(404, detail="Project not found")


@router.post("/projects/snapshot")
def create_snapshot():
    db_dir = Path.home() / ".mt_track"
    db_path = db_dir / "mt_track.db"
    if not db_path.exists():
        raise HTTPException(404, detail="Database file not found")
    snap_dir = db_dir / "snapshots"
    snap_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    snap_path = snap_dir / f"mt_track_{ts}.db"
    shutil.copy2(str(db_path), str(snap_path))
    return {"path": str(snap_path), "size_bytes": snap_path.stat().st_size}
