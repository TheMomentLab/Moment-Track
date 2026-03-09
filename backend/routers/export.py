"""Export router — dataset export in various formats."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.config import settings
from backend.db.database import get_db
from backend.schemas.export import ExportInfoResponse, ExportResponse, MotExportRequest, YoloExportRequest
from backend.services import export_service

router = APIRouter()


@router.get("/projects/{project_id}/export/info", response_model=ExportInfoResponse)
def get_export_info(project_id: int):
    export_dir = settings.export_root / str(project_id) / "exports"
    return ExportInfoResponse(export_dir=str(Path(export_dir)))


@router.post(
    "/projects/{project_id}/export/yolo", response_model=ExportResponse, status_code=201
)
def export_yolo(project_id: int, body: YoloExportRequest, db: Session = Depends(get_db)):
    """Export dataset in YOLO detection format."""
    try:
        return export_service.export_yolo(db, project_id, body)
    except ValueError as e:
        raise HTTPException(422, detail=str(e))


@router.post(
    "/projects/{project_id}/export/mot", response_model=ExportResponse, status_code=201
)
def export_mot(project_id: int, body: MotExportRequest, db: Session = Depends(get_db)):
    """Export dataset in MOT Challenge format."""
    try:
        return export_service.export_mot(db, project_id, body)
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
