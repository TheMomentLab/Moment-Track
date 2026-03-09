"""ByteTrack tracking task - assigns track IDs to existing detections."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from collections import Counter
from importlib import import_module
from types import SimpleNamespace
from typing import Any

import numpy as np

from backend.db.models import Detection, Identity, Track, Video
from worker import ipc
from worker.ipc import JobReporter

log = logging.getLogger(__name__)

DEFAULT_TRACK_THRESH = 0.5
DEFAULT_MATCH_THRESH = 0.8
DEFAULT_TRACK_BUFFER = 30
DEFAULT_FRAME_RATE = 30
BYTETRACK_IOU_MIN = 0.1

def _as_int(value: object, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, (int, float, str)):
        return int(value)
    return default


def _as_float(value: object, default: float) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float, str)):
        return float(value)
    return default


def _iou(box_a: np.ndarray, box_b: np.ndarray) -> float:
    x1 = max(float(box_a[0]), float(box_b[0]))
    y1 = max(float(box_a[1]), float(box_b[1]))
    x2 = min(float(box_a[2]), float(box_b[2]))
    y2 = min(float(box_a[3]), float(box_b[3]))
    inter_w = max(0.0, x2 - x1)
    inter_h = max(0.0, y2 - y1)
    inter_area = inter_w * inter_h
    if inter_area <= 0.0:
        return 0.0

    area_a = max(0.0, float(box_a[2] - box_a[0])) * max(0.0, float(box_a[3] - box_a[1]))
    area_b = max(0.0, float(box_b[2] - box_b[0])) * max(0.0, float(box_b[3] - box_b[1]))
    denom = area_a + area_b - inter_area
    if denom <= 0.0:
        return 0.0
    return inter_area / denom


def _track_with_iou(
    frames: dict[int, list[Detection]],
    match_thresh: float,
    track_buffer: int,
) -> dict[int, int]:
    next_track_id = 1
    active_tracks: dict[int, tuple[np.ndarray, int]] = {}
    detection_to_track: dict[int, int] = {}

    for frame_idx in sorted(frames):
        frame_detections = frames[frame_idx]
        det_boxes = {
            det.id: np.array([det.x, det.y, det.x + det.w, det.y + det.h], dtype=np.float32)
            for det in frame_detections
        }

        candidates: list[tuple[float, int, int]] = []
        for det_id, det_box in det_boxes.items():
            for track_id, state in active_tracks.items():
                iou_value = _iou(det_box, state[0])
                if iou_value >= match_thresh:
                    candidates.append((iou_value, det_id, track_id))

        assigned_det: set[int] = set()
        assigned_track: set[int] = set()
        for _, det_id, track_id in sorted(candidates, key=lambda item: item[0], reverse=True):
            if det_id in assigned_det or track_id in assigned_track:
                continue
            assigned_det.add(det_id)
            assigned_track.add(track_id)
            detection_to_track[det_id] = track_id
            active_tracks[track_id] = (det_boxes[det_id], frame_idx)

        for det in frame_detections:
            if det.id in assigned_det:
                continue
            track_id = next_track_id
            next_track_id += 1
            detection_to_track[det.id] = track_id
            active_tracks[track_id] = (det_boxes[det.id], frame_idx)

        stale_track_ids = [
            track_id
            for track_id, state in active_tracks.items()
            if frame_idx - state[1] > track_buffer
        ]
        for track_id in stale_track_ids:
            del active_tracks[track_id]

    return detection_to_track


def _track_with_bytetrack(
    frames: dict[int, list[Detection]],
    track_thresh: float,
    match_thresh: float,
    track_buffer: int,
    frame_rate: int,
) -> dict[int, int] | None:
    try:
        BYTETracker = import_module("ultralytics.trackers.byte_tracker").BYTETracker
    except ImportError:
        return None

    args = SimpleNamespace(
        track_thresh=track_thresh,
        match_thresh=match_thresh,
        track_buffer=track_buffer,
        mot20=False,
    )

    try:
        tracker = BYTETracker(args=args, frame_rate=frame_rate)
    except Exception:
        log.exception("Failed to initialize BYTETracker; falling back to IoU tracker")
        return None

    detection_to_track: dict[int, int] = {}
    for frame_idx in sorted(frames):
        frame_detections = frames[frame_idx]
        if not frame_detections:
            continue

        det_array = np.array(
            [[det.x, det.y, det.x + det.w, det.y + det.h, float(det.confidence or 0.0)] for det in frame_detections],
            dtype=np.float32,
        )

        try:
            tracks = tracker.update(det_array, (1, 1), (1, 1))
        except TypeError:
            try:
                tracks = tracker.update(det_array)
            except Exception:
                log.exception("BYTETracker update failed; falling back to IoU tracker")
                return None
        except Exception:
            log.exception("BYTETracker update failed; falling back to IoU tracker")
            return None

        available_det_ids = {det.id for det in frame_detections}
        det_boxes = {
            det.id: np.array([det.x, det.y, det.x + det.w, det.y + det.h], dtype=np.float32)
            for det in frame_detections
        }

        track_items: list[Any]
        track_items = tracks if isinstance(tracks, list) else []
        for track in track_items:
            track_id = getattr(track, "track_id", None)
            if track_id is None:
                continue

            if hasattr(track, "tlbr"):
                track_box = np.array(track.tlbr, dtype=np.float32)
            elif hasattr(track, "tlwh"):
                x, y, w, h = [float(v) for v in track.tlwh]
                track_box = np.array([x, y, x + w, y + h], dtype=np.float32)
            else:
                continue

            best_det_id = None
            best_iou = 0.0
            for det_id in available_det_ids:
                iou_value = _iou(det_boxes[det_id], track_box)
                if iou_value > best_iou:
                    best_iou = iou_value
                    best_det_id = det_id

            if best_det_id is not None and best_iou > BYTETRACK_IOU_MIN:
                detection_to_track[best_det_id] = int(track_id)
                available_det_ids.remove(best_det_id)

    if not detection_to_track:
        return None
    return detection_to_track


def run_track(job_id: int, params: Mapping[str, object], reporter: JobReporter) -> None:
    video_id = _as_int(params.get("video_id"), -1)
    if video_id < 0:
        raise ValueError("video_id is required")

    frame_start = _as_int(params.get("frame_start"), 0)
    frame_end = params.get("frame_end")
    track_thresh = _as_float(params.get("track_thresh"), DEFAULT_TRACK_THRESH)
    match_thresh = _as_float(params.get("match_thresh"), DEFAULT_MATCH_THRESH)
    track_buffer = _as_int(params.get("track_buffer"), DEFAULT_TRACK_BUFFER)

    db = ipc.get_worker_db_session()
    try:
        video = db.query(Video).filter(Video.id == video_id).first()
        if video is None:
            raise ValueError(f"Video {video_id} not found")

        frame_rate = DEFAULT_FRAME_RATE
        if video.fps > 0:
            frame_rate = max(1, int(round(video.fps)))

        detections_query = db.query(Detection).filter(Detection.video_id == video_id)
        detections_query = detections_query.filter(Detection.frame_idx >= frame_start)
        if frame_end is not None:
            detections_query = detections_query.filter(
                Detection.frame_idx < _as_int(frame_end, frame_start + 1)
            )

        detections = detections_query.order_by(Detection.frame_idx.asc(), Detection.id.asc()).all()
        if not detections:
            raise ValueError("No detections found for this video")

        frames: dict[int, list[Detection]] = {}
        for det in detections:
            frames.setdefault(det.frame_idx, []).append(det)

        byte_tracks = _track_with_bytetrack(
            frames,
            track_thresh,
            match_thresh,
            track_buffer,
            frame_rate,
        )
        if byte_tracks is None:
            detection_to_track = _track_with_iou(frames, match_thresh, track_buffer)
        else:
            detection_to_track = byte_tracks

        frame_indices = sorted(frames.keys())
        total = max(1, len(frame_indices))
        for idx, _frame_idx in enumerate(frame_indices, start=1):
            reporter.update_progress(idx / total)
            if reporter.is_cancelled:
                log.info("Tracking job %s cancelled", job_id)
                return

        grouped_by_temp_track: dict[int, list[Detection]] = {}
        for det in detections:
            temp_track_id = detection_to_track.get(det.id)
            if temp_track_id is None:
                continue
            grouped_by_temp_track.setdefault(temp_track_id, []).append(det)

        for _, det_group in grouped_by_temp_track.items():
            class_name = Counter(det.class_name for det in det_group).most_common(1)[0][0]
            start_frame = min(det.frame_idx for det in det_group)
            end_frame = max(det.frame_idx for det in det_group)

            identity = Identity(project_id=video.project_id, class_name=class_name, label=None)
            db.add(identity)
            db.flush()

            track = Track(
                identity_id=identity.id,
                video_id=video_id,
                start_frame=start_frame,
                end_frame=end_frame,
                source="auto",
            )
            db.add(track)
            db.flush()

            for det in det_group:
                det.track_id = track.id

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
