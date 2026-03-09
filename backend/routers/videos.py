"""Videos router — video management and frame serving."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from backend.db.database import get_db
from backend.schemas.common import PaginatedResponse
from backend.schemas.video import VideoCreate, VideoMeta, VideoRead
from backend.services import video_service

router = APIRouter()


@router.get("/projects/{project_id}/videos", response_model=PaginatedResponse[VideoRead])
def list_videos(
    project_id: int,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    total, items = video_service.list_videos(db, project_id, limit, offset)
    return PaginatedResponse(total=total, items=items)


@router.post("/projects/{project_id}/videos", response_model=VideoRead, status_code=201)
def add_video(project_id: int, body: VideoCreate, db: Session = Depends(get_db)):
    try:
        video = video_service.add_video(db, project_id, body)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    if video is None:
        raise HTTPException(404, detail="Project not found")
    return video


@router.post("/projects/{project_id}/videos/upload", response_model=VideoRead, status_code=201)
async def upload_video(
    project_id: int,
    file: UploadFile = File(...),
    camera_id: str = Form("default"),
    db: Session = Depends(get_db),
):
    try:
        video = await video_service.upload_video_file(db, project_id, file, camera_id)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    if video is None:
        raise HTTPException(404, detail="Project not found")
    return video


@router.get("/videos/{video_id}/frame/{frame_idx}")
def get_frame(video_id: int, frame_idx: int, db: Session = Depends(get_db)):
    try:
        jpeg = video_service.get_frame_jpeg(db, video_id, frame_idx)
    except IndexError as e:
        raise HTTPException(404, detail=str(e))
    except (IOError, Exception) as e:
        raise HTTPException(500, detail=str(e))
    if jpeg is None:
        raise HTTPException(404, detail="Video not found")
    return Response(content=jpeg, media_type="image/jpeg")


@router.get("/videos/{video_id}/meta", response_model=VideoMeta)
def get_video_meta(video_id: int, db: Session = Depends(get_db)):
    meta = video_service.get_video_meta(db, video_id)
    if meta is None:
        raise HTTPException(404, detail="Video not found")
    return meta
