"""Annotation business logic — Detection, Track, Identity CRUD + merge/split/interpolate."""

import logging

import numpy as np

from sqlalchemy.orm import Session

from backend.db.models import Detection, Embedding, Identity, Track
from backend.schemas.annotation import (
    CropItem,
    DetectionCreate,
    DetectionRead,
    DetectionUpdate,
    IdentityCreate,
    IdentityMergeResponse,
    IdentityRead,
    IdentityUpdate,
    InterpolateResponse,
    TrackRead,
    TrackUpdate,
)


# ────────────────────────── helpers ──────────────────────────


def _det(d: Detection) -> DetectionRead:
    return DetectionRead(
        id=d.id,
        track_id=d.track_id,
        video_id=d.video_id,
        frame_idx=d.frame_idx,
        x=d.x,
        y=d.y,
        w=d.w,
        h=d.h,
        confidence=d.confidence,
        class_name=d.class_name,
        is_keyframe=d.is_keyframe,
        is_interpolated=d.is_interpolated,
        source=d.source,
    )


def _track(t: Track) -> TrackRead:
    return TrackRead(
        id=t.id,
        identity_id=t.identity_id,
        video_id=t.video_id,
        start_frame=t.start_frame,
        end_frame=t.end_frame,
        detection_count=len(t.detections),
        source=t.source,
        created_at=t.created_at,
    )


def _identity(i: Identity) -> IdentityRead:
    return IdentityRead(
        id=i.id,
        project_id=i.project_id,
        label=i.label,
        class_name=i.class_name,
        track_count=len(i.tracks),
        created_at=i.created_at,
    )


# ────────────────────────── detections ──────────────────────────


def list_detections(
    db: Session,
    video_id: int,
    frame_start: int,
    frame_end: int | None,
    track_id: int | None,
    limit: int,
    offset: int,
) -> tuple[int, list[DetectionRead]]:
    q = db.query(Detection).filter(Detection.video_id == video_id)
    q = q.filter(Detection.frame_idx >= frame_start)
    if frame_end is not None:
        q = q.filter(Detection.frame_idx <= frame_end)
    if track_id is not None:
        q = q.filter(Detection.track_id == track_id)
    total = q.count()
    rows = q.order_by(Detection.frame_idx).offset(offset).limit(limit).all()
    return total, [_det(r) for r in rows]


def create_detection(db: Session, video_id: int, body: DetectionCreate) -> DetectionRead:
    track_id = body.track_id

    # If no track_id given, create a new Track for this detection
    if track_id is None:
        track = Track(
            video_id=video_id,
            start_frame=body.frame_idx,
            end_frame=body.frame_idx,
            source="manual",
        )
        db.add(track)
        db.flush()
        track_id = track.id

    detection = Detection(
        track_id=track_id,
        video_id=video_id,
        frame_idx=body.frame_idx,
        x=body.x,
        y=body.y,
        w=body.w,
        h=body.h,
        class_name=body.class_name,
        is_keyframe=body.is_keyframe,
        is_interpolated=False,
        source="manual",
    )
    db.add(detection)

    # Update track frame range
    track_row = db.query(Track).filter(Track.id == track_id).first()
    if track_row:
        track_row.start_frame = min(track_row.start_frame, body.frame_idx)
        track_row.end_frame = max(track_row.end_frame, body.frame_idx)

    db.commit()
    db.refresh(detection)
    return _det(detection)


def update_detection(
    db: Session, detection_id: int, body: DetectionUpdate
) -> DetectionRead | None:
    det = db.query(Detection).filter(Detection.id == detection_id).first()
    if det is None:
        return None
    if body.x is not None:
        det.x = body.x
    if body.y is not None:
        det.y = body.y
    if body.w is not None:
        det.w = body.w
    if body.h is not None:
        det.h = body.h
    if body.class_name is not None:
        det.class_name = body.class_name
    if body.is_keyframe is not None:
        det.is_keyframe = body.is_keyframe
    db.commit()
    db.refresh(det)
    return _det(det)


def delete_detection(db: Session, detection_id: int) -> bool:
    det = db.query(Detection).filter(Detection.id == detection_id).first()
    if det is None:
        return False
    track_id = det.track_id
    db.delete(det)
    db.commit()
    # Auto-delete track if it has no more detections
    if track_id is not None:
        remaining = db.query(Detection).filter(Detection.track_id == track_id).count()
        if remaining == 0:
            track = db.query(Track).filter(Track.id == track_id).first()
            if track:
                db.delete(track)
                db.commit()
    return True


def interpolate_detections(
    db: Session, video_id: int, track_id: int, frame_start: int, frame_end: int
) -> InterpolateResponse:
    """Linear interpolation between two keyframe detections."""
    kf_start = (
        db.query(Detection)
        .filter(
            Detection.track_id == track_id,
            Detection.video_id == video_id,
            Detection.frame_idx == frame_start,
            Detection.is_keyframe.is_(True),
        )
        .first()
    )
    kf_end = (
        db.query(Detection)
        .filter(
            Detection.track_id == track_id,
            Detection.video_id == video_id,
            Detection.frame_idx == frame_end,
            Detection.is_keyframe.is_(True),
        )
        .first()
    )
    if kf_start is None or kf_end is None:
        raise ValueError("frame_start or frame_end has no keyframe detection for this track")

    n = frame_end - frame_start
    created: list[Detection] = []
    for i in range(1, n):
        t = i / n
        mid = Detection(
            track_id=track_id,
            video_id=video_id,
            frame_idx=frame_start + i,
            x=kf_start.x + t * (kf_end.x - kf_start.x),
            y=kf_start.y + t * (kf_end.y - kf_start.y),
            w=kf_start.w + t * (kf_end.w - kf_start.w),
            h=kf_start.h + t * (kf_end.h - kf_start.h),
            class_name=kf_start.class_name,
            is_keyframe=False,
            is_interpolated=True,
            source="manual",
        )
        db.add(mid)
        created.append(mid)

    db.commit()
    for d in created:
        db.refresh(d)
    return InterpolateResponse(created_count=len(created), detections=[_det(d) for d in created])


# ────────────────────────── tracks ──────────────────────────


def list_tracks(
    db: Session,
    project_id: int,
    video_id: int | None,
    identity_id: int | None,
    unassigned: bool,
    limit: int,
    offset: int,
) -> tuple[int, list[TrackRead]]:
    q = db.query(Track).join(Track.video).filter(Track.video.has(project_id=project_id))
    if video_id is not None:
        q = q.filter(Track.video_id == video_id)
    if identity_id is not None:
        q = q.filter(Track.identity_id == identity_id)
    if unassigned:
        q = q.filter(Track.identity_id.is_(None))
    total = q.count()
    rows = q.order_by(Track.id).offset(offset).limit(limit).all()
    return total, [_track(r) for r in rows]


def update_track(db: Session, track_id: int, body: TrackUpdate) -> TrackRead | None:
    track = db.query(Track).filter(Track.id == track_id).first()
    if track is None:
        return None
    track.identity_id = body.identity_id
    db.commit()
    db.refresh(track)
    return _track(track)


def merge_tracks(db: Session, track_id_a: int, track_id_b: int) -> TrackRead | None:
    """Merge track B into track A. Fails if their frame ranges overlap."""
    ta = db.query(Track).filter(Track.id == track_id_a).first()
    tb = db.query(Track).filter(Track.id == track_id_b).first()
    if ta is None or tb is None:
        return None
    # Check for overlap
    if ta.start_frame <= tb.end_frame and tb.start_frame <= ta.end_frame:
        raise ValueError("Tracks overlap — cannot merge")

    # Re-assign all detections of B to A
    db.query(Detection).filter(Detection.track_id == track_id_b).update(
        {Detection.track_id: track_id_a}
    )
    # Expand A's frame range
    ta.start_frame = min(ta.start_frame, tb.start_frame)
    ta.end_frame = max(ta.end_frame, tb.end_frame)
    db.delete(tb)
    db.commit()
    db.refresh(ta)
    return _track(ta)


def split_track(db: Session, track_id: int, split_frame: int) -> tuple[TrackRead, TrackRead] | None:
    """Split a track at split_frame → [start, split_frame-1] / [split_frame, end]."""
    track = db.query(Track).filter(Track.id == track_id).first()
    if track is None:
        return None
    if split_frame <= track.start_frame or split_frame > track.end_frame:
        raise ValueError("split_frame is at a boundary — cannot split")

    # Create track B for [split_frame, end]
    tb = Track(
        identity_id=track.identity_id,
        video_id=track.video_id,
        start_frame=split_frame,
        end_frame=track.end_frame,
        source=track.source,
    )
    db.add(tb)
    db.flush()

    # Move detections >= split_frame to track B
    db.query(Detection).filter(
        Detection.track_id == track_id, Detection.frame_idx >= split_frame
    ).update({Detection.track_id: tb.id})

    # Shrink track A
    track.end_frame = split_frame - 1
    db.commit()
    db.refresh(track)
    db.refresh(tb)
    return _track(track), _track(tb)


def delete_track(db: Session, track_id: int) -> bool:
    track = db.query(Track).filter(Track.id == track_id).first()
    if track is None:
        return False
    db.delete(track)
    db.commit()
    return True


# ────────────────────────── identities ──────────────────────────


def list_identities(
    db: Session, project_id: int, limit: int, offset: int
) -> tuple[int, list[IdentityRead]]:
    total = db.query(Identity).filter(Identity.project_id == project_id).count()
    rows = (
        db.query(Identity)
        .filter(Identity.project_id == project_id)
        .order_by(Identity.id)
        .offset(offset)
        .limit(limit)
        .all()
    )
    return total, [_identity(r) for r in rows]


def create_identity(db: Session, project_id: int, body: IdentityCreate) -> IdentityRead:
    identity = Identity(
        project_id=project_id,
        class_name=body.class_name,
        label=body.label,
    )
    db.add(identity)
    db.commit()
    db.refresh(identity)
    return _identity(identity)


def update_identity(
    db: Session, identity_id: int, body: IdentityUpdate
) -> IdentityRead | None:
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if identity is None:
        return None
    if body.label is not None:
        identity.label = body.label
    if body.class_name is not None:
        identity.class_name = body.class_name
    db.commit()
    db.refresh(identity)
    return _identity(identity)


def merge_identities(
    db: Session, identity_id_a: int, identity_id_b: int
) -> IdentityMergeResponse | None:
    ia = db.query(Identity).filter(Identity.id == identity_id_a).first()
    ib = db.query(Identity).filter(Identity.id == identity_id_b).first()
    if ia is None or ib is None:
        return None
    moved = db.query(Track).filter(Track.identity_id == identity_id_b).count()
    db.query(Track).filter(Track.identity_id == identity_id_b).update(
        {Track.identity_id: identity_id_a}
    )
    db.delete(ib)
    db.commit()
    db.refresh(ia)
    return IdentityMergeResponse(merged_identity=_identity(ia), moved_track_count=moved)


def delete_identity(db: Session, identity_id: int) -> bool:
    identity = db.query(Identity).filter(Identity.id == identity_id).first()
    if identity is None:
        return False
    # Unassign all tracks (do not delete them)
    db.query(Track).filter(Track.identity_id == identity_id).update(
        {Track.identity_id: None}
    )
    db.delete(identity)
    db.commit()
    return True


def _compute_anomaly_scores(
    db: Session, all_detection_ids: list[int], page_detection_ids: list[int],
) -> dict[int, float]:
    """Compute anomaly scores based on cosine distance from identity's mean embedding."""
    if len(all_detection_ids) < 3:
        return {}

    # Fetch all embeddings for this identity's detections
    embeddings = (
        db.query(Embedding)
        .filter(Embedding.detection_id.in_(all_detection_ids))
        .all()
    )
    if len(embeddings) < 3:
        return {}

    try:
        vectors = {}
        for emb in embeddings:
            vectors[emb.detection_id] = np.frombuffer(emb.vector, dtype=np.float32).copy()

        mat = np.stack(list(vectors.values()))
        mean_vec = mat.mean(axis=0)
        mean_norm = np.linalg.norm(mean_vec)
        if mean_norm < 1e-9:
            return {}

        scores: dict[int, float] = {}
        for det_id in page_detection_ids:
            vec = vectors.get(det_id)
            if vec is None:
                continue
            vec_norm = np.linalg.norm(vec)
            if vec_norm < 1e-9:
                scores[det_id] = 1.0
                continue
            cos_sim = float(np.dot(vec, mean_vec) / (vec_norm * mean_norm))
            scores[det_id] = round(max(0.0, 1.0 - cos_sim), 4)
        return scores
    except Exception:
        logging.getLogger(__name__).debug("Anomaly score computation failed", exc_info=True)
        return {}


def get_identity_crops(
    db: Session,
    identity_id: int,
    stride: int,
    keyframes_only: bool,
    limit: int,
    offset: int,
) -> tuple[int, list[CropItem]]:
    """Return crop metadata for all detections under this identity."""
    q = (
        db.query(Detection)
        .join(Detection.track)
        .filter(Track.identity_id == identity_id)
    )
    if keyframes_only:
        q = q.filter(Detection.is_keyframe.is_(True))

    all_rows = q.order_by(Detection.video_id, Detection.frame_idx).all()
    # Apply stride filter
    strided = [r for i, r in enumerate(all_rows) if i % stride == 0]
    total = len(strided)
    page = strided[offset : offset + limit]

    # Compute anomaly scores from embeddings
    all_det_ids = [d.id for d in strided]
    page_det_ids = [d.id for d in page]
    anomaly_scores = _compute_anomaly_scores(db, all_det_ids, page_det_ids)

    items = [
        CropItem(
            detection_id=d.id,
            video_id=d.video_id,
            frame_idx=d.frame_idx,
            track_id=d.track_id,
            bbox={"x": d.x, "y": d.y, "w": d.w, "h": d.h},
            anomaly_score=anomaly_scores.get(d.id),
        )
        for d in page
    ]
    return total, items
