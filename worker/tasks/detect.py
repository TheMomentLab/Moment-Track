"""YOLO detection task - runs object detection on video frames."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from importlib import import_module
from typing import Any

import cv2

from backend.db.models import Detection
from worker import ipc
from worker.ipc import JobReporter

log = logging.getLogger(__name__)


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


def _as_str_list(value: object) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value]
    return None


def run_detect(job_id: int, params: Mapping[str, object], reporter: JobReporter) -> None:
    video_id = _as_int(params.get("video_id"), -1)
    if video_id < 0:
        raise ValueError("video_id is required")

    model_path = str(params.get("model_path", ""))
    if not model_path:
        raise ValueError("model_path is required")

    frame_start = _as_int(params.get("frame_start"), 0)
    frame_end = params.get("frame_end")
    classes = _as_str_list(params.get("classes"))
    conf_threshold = _as_float(params.get("conf_threshold"), 0.5)
    iou_threshold = _as_float(params.get("iou_threshold"), 0.45)

    try:
        torch = import_module("torch")
    except ImportError as exc:
        raise RuntimeError(
            "torch is required for detection. Install with: pip install mt-track[gpu]"
        ) from exc

    try:
        YOLO: Any = import_module("ultralytics").YOLO
    except ImportError as exc:
        raise RuntimeError(
            "ultralytics is required for detection. Install with: pip install mt-track[gpu]"
        ) from exc

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = YOLO(model_path)

    write_db = ipc.get_worker_db_session()
    capture = None
    try:
        video_path = ipc.get_video_path(write_db, video_id)
        capture = cv2.VideoCapture(video_path)
        if not capture.isOpened():
            raise RuntimeError(f"Failed to open video: {video_path}")

        video_total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if frame_end is None:
            frame_end = video_total_frames
        frame_end = _as_int(frame_end, video_total_frames)

        frame_start = max(0, frame_start)
        frame_end = min(frame_end, video_total_frames) if video_total_frames > 0 else frame_end
        total_frames = max(1, frame_end - frame_start)

        if frame_start >= frame_end:
            raise ValueError("Invalid frame range for detection")

        if classes:
            class_filter = set(classes)
        else:
            class_filter = None

        capture.set(cv2.CAP_PROP_POS_FRAMES, frame_start)

        processed_frames = 0
        for frame_idx in range(frame_start, frame_end):
            ok, frame = capture.read()
            if not ok:
                break

            result_list = model.predict(
                frame,
                conf=conf_threshold,
                iou=iou_threshold,
                verbose=False,
                device=device,
            )
            result = result_list[0]
            boxes = result.boxes
            names = result.names if result.names is not None else {}

            if boxes is not None and boxes.xyxy is not None:
                xyxy = boxes.xyxy.cpu().numpy()
                confs = boxes.conf.cpu().numpy() if boxes.conf is not None else None
                cls_ids = boxes.cls.cpu().numpy() if boxes.cls is not None else None

                for idx, coords in enumerate(xyxy):
                    x1, y1, x2, y2 = [float(v) for v in coords]
                    width = max(0.0, x2 - x1)
                    height = max(0.0, y2 - y1)

                    class_name = "object"
                    if cls_ids is not None:
                        class_idx = int(cls_ids[idx])
                        class_name = str(names.get(class_idx, class_idx))

                    if class_filter is not None and class_name not in class_filter:
                        continue

                    confidence = float(confs[idx]) if confs is not None else None

                    detection = Detection(
                        track_id=None,
                        video_id=video_id,
                        frame_idx=frame_idx,
                        x=x1,
                        y=y1,
                        w=width,
                        h=height,
                        confidence=confidence,
                        class_name=class_name,
                        is_keyframe=True,
                        is_interpolated=False,
                        source="auto",
                    )
                    write_db.add(detection)

            processed_frames += 1
            if processed_frames % 100 == 0:
                write_db.commit()

            reporter.update_progress((frame_idx - frame_start) / total_frames)
            if reporter.is_cancelled:
                log.info("Detection job %s cancelled", job_id)
                break

        write_db.commit()
    except Exception:
        write_db.rollback()
        raise
    finally:
        if capture is not None:
            capture.release()
        write_db.close()
