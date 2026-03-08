"""Annotations router — Detection, Track, Identity CRUD."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.db.database import get_db
from backend.services import annotation_service
from backend.schemas.annotation import (
    CropItem,
    DetectionCreate,
    DetectionRead,
    DetectionUpdate,
    IdentityCreate,
    IdentityMergeRequest,
    IdentityMergeResponse,
    IdentityRead,
    IdentityUpdate,
    InterpolateRequest,
    InterpolateResponse,
    TrackMergeRequest,
    TrackRead,
    TrackSplitRequest,
    TrackSplitResponse,
    TrackUpdate,
)
from backend.schemas.common import PaginatedResponse

router = APIRouter()


# ---- Detections ----


@router.get("/videos/{video_id}/detections", response_model=PaginatedResponse[DetectionRead])
def list_detections(
    video_id: int,
    frame_start: int = 0,
    frame_end: int | None = None,
    track_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """List detections in a frame range."""
    total, items = annotation_service.list_detections(
        db, video_id, frame_start, frame_end, track_id, limit, offset
    )
    return PaginatedResponse(total=total, items=items)


@router.post("/videos/{video_id}/detections", response_model=DetectionRead, status_code=201)
def create_detection(video_id: int, body: DetectionCreate, db: Session = Depends(get_db)):
    """Create a detection manually."""
    return annotation_service.create_detection(db, video_id, body)


@router.patch("/detections/{detection_id}", response_model=DetectionRead)
def update_detection(detection_id: int, body: DetectionUpdate, db: Session = Depends(get_db)):
    """Update a detection."""
    result = annotation_service.update_detection(db, detection_id, body)
    if result is None:
        raise HTTPException(404, detail="Detection not found")
    return result


@router.delete("/detections/{detection_id}", status_code=204)
def delete_detection(detection_id: int, db: Session = Depends(get_db)):
    """Delete a detection."""
    ok = annotation_service.delete_detection(db, detection_id)
    if not ok:
        raise HTTPException(404, detail="Detection not found")


@router.post(
    "/videos/{video_id}/detections/interpolate", response_model=InterpolateResponse, status_code=201
)
def interpolate_detections(
    video_id: int, body: InterpolateRequest, db: Session = Depends(get_db)
):
    """Linearly interpolate detections between two keyframes."""
    try:
        return annotation_service.interpolate_detections(
            db, video_id, body.track_id, body.frame_start, body.frame_end
        )
    except ValueError as e:
        raise HTTPException(422, detail=str(e))


# ---- Tracks ----


@router.get("/projects/{project_id}/tracks", response_model=PaginatedResponse[TrackRead])
def list_tracks(
    project_id: int,
    video_id: int | None = None,
    identity_id: int | None = None,
    unassigned: bool = False,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """List tracks in a project."""
    total, items = annotation_service.list_tracks(
        db, project_id, video_id, identity_id, unassigned, limit, offset
    )
    return PaginatedResponse(total=total, items=items)


@router.patch("/tracks/{track_id}", response_model=TrackRead)
def update_track(track_id: int, body: TrackUpdate, db: Session = Depends(get_db)):
    """Change track's identity assignment."""
    result = annotation_service.update_track(db, track_id, body)
    if result is None:
        raise HTTPException(404, detail="Track not found")
    return result


@router.post("/tracks/merge", response_model=TrackRead)
def merge_tracks(body: TrackMergeRequest, db: Session = Depends(get_db)):
    """Merge two tracks into one."""
    try:
        result = annotation_service.merge_tracks(db, body.track_id_a, body.track_id_b)
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
    if result is None:
        raise HTTPException(404, detail="One or both tracks not found")
    return result


@router.post("/tracks/{track_id}/split", response_model=TrackSplitResponse, status_code=201)
def split_track(track_id: int, body: TrackSplitRequest, db: Session = Depends(get_db)):
    """Split a track at a given frame."""
    try:
        result = annotation_service.split_track(db, track_id, body.split_frame)
    except ValueError as e:
        raise HTTPException(422, detail=str(e))
    if result is None:
        raise HTTPException(404, detail="Track not found")
    track_a, track_b = result
    return TrackSplitResponse(track_a=track_a, track_b=track_b)


@router.delete("/tracks/{track_id}", status_code=204)
def delete_track(track_id: int, db: Session = Depends(get_db)):
    """Delete a track and its detections."""
    ok = annotation_service.delete_track(db, track_id)
    if not ok:
        raise HTTPException(404, detail="Track not found")


# ---- Identities ----


@router.get(
    "/projects/{project_id}/identities", response_model=PaginatedResponse[IdentityRead]
)
def list_identities(
    project_id: int,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """List identities in a project."""
    total, items = annotation_service.list_identities(db, project_id, limit, offset)
    return PaginatedResponse(total=total, items=items)


@router.post("/projects/{project_id}/identities", response_model=IdentityRead, status_code=201)
def create_identity(project_id: int, body: IdentityCreate, db: Session = Depends(get_db)):
    """Create a new identity."""
    return annotation_service.create_identity(db, project_id, body)


@router.patch("/identities/{identity_id}", response_model=IdentityRead)
def update_identity(identity_id: int, body: IdentityUpdate, db: Session = Depends(get_db)):
    """Update an identity."""
    result = annotation_service.update_identity(db, identity_id, body)
    if result is None:
        raise HTTPException(404, detail="Identity not found")
    return result


@router.post("/identities/merge", response_model=IdentityMergeResponse)
def merge_identities(body: IdentityMergeRequest, db: Session = Depends(get_db)):
    """Merge two identities into one."""
    try:
        result = annotation_service.merge_identities(db, body.identity_id_a, body.identity_id_b)
    except Exception as e:
        raise HTTPException(422, detail=str(e))
    if result is None:
        raise HTTPException(404, detail="One or both identities not found")
    return result


@router.delete("/identities/{identity_id}", status_code=204)
def delete_identity(identity_id: int, db: Session = Depends(get_db)):
    """Delete an identity (tracks become unassigned)."""
    ok = annotation_service.delete_identity(db, identity_id)
    if not ok:
        raise HTTPException(404, detail="Identity not found")


@router.get(
    "/identities/{identity_id}/crops", response_model=PaginatedResponse[CropItem]
)
def get_identity_crops(
    identity_id: int,
    stride: int = 10,
    keyframes_only: bool = False,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """Get crop metadata for an identity."""
    total, items = annotation_service.get_identity_crops(
        db, identity_id, stride, keyframes_only, limit, offset
    )
    return PaginatedResponse(total=total, items=items)
