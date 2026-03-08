"""Export router — dataset export in various formats."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.db.database import get_db
from backend.schemas.export import ExportResponse, MotExportRequest, YoloExportRequest
from backend.services import export_service

router = APIRouter()


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
