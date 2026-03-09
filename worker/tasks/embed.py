"""ReID embedding computation task."""

from __future__ import annotations

import logging
from importlib import import_module
from pathlib import Path
from typing import Any, Mapping

import cv2
import numpy as np
from sqlalchemy import and_

from backend.db.models import Detection, Embedding
from worker import ipc
from worker.ipc import JobReporter

log = logging.getLogger(__name__)

ParamValue = int | float | str | list[str] | None

REID_INPUT_SIZE = (128, 256)
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
DEFAULT_REID_MODEL = "osnet_x1_0"
DEFAULT_REID_NUM_CLASSES = 1000
FALLBACK_MODEL = "resnet50"
DEFAULT_BATCH_SIZE = 64


def _prepare_tensor(torch_module: Any, crop: np.ndarray) -> Any:
    resized = cv2.resize(crop, REID_INPUT_SIZE, interpolation=cv2.INTER_LINEAR)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
    image = rgb.astype(np.float32) / 255.0
    image = np.transpose(image, (2, 0, 1))

    tensor = torch_module.from_numpy(image)
    mean = torch_module.tensor(IMAGENET_MEAN, dtype=tensor.dtype).view(3, 1, 1)
    std = torch_module.tensor(IMAGENET_STD, dtype=tensor.dtype).view(3, 1, 1)
    return (tensor - mean) / std


def _load_model(torch_module: Any, device: str, model_path: str) -> tuple[Any, str]:
    try:
        torchreid = import_module("torchreid")
    except ImportError:
        torchreid = None

    if torchreid is not None:
        model = torchreid.models.build_model(
            name=DEFAULT_REID_MODEL, num_classes=DEFAULT_REID_NUM_CLASSES, pretrained=True
        )
        if model_path and Path(model_path).exists():
            state_dict = torch_module.load(model_path, map_location=device)
            model.load_state_dict(state_dict, strict=False)
        model.eval()
        model.to(device)
        return model, f"torchreid:{DEFAULT_REID_MODEL}"

    models = import_module("torchvision.models")
    weights = getattr(models, "ResNet50_Weights", None)
    if weights is not None:
        model = getattr(models, FALLBACK_MODEL)(weights=weights.DEFAULT)
    else:
        model = getattr(models, FALLBACK_MODEL)(pretrained=True)
    model.fc = torch_module.nn.Identity()
    model.eval()
    model.to(device)
    return model, f"torchvision:{FALLBACK_MODEL}"


def run_embed(job_id: int, params: Mapping[str, object], reporter: JobReporter) -> None:
    raw_video_id = params.get("video_id")
    if not isinstance(raw_video_id, (int, float, str)):
        raise ValueError("video_id is required")
    video_id = int(raw_video_id)

    model_path = str(params.get("model_path", ""))

    raw_batch_size = params.get("batch_size", DEFAULT_BATCH_SIZE)
    batch_size = int(raw_batch_size) if isinstance(raw_batch_size, (int, float, str)) else DEFAULT_BATCH_SIZE
    batch_size = max(1, batch_size)

    try:
        torch = import_module("torch")
    except ImportError as exc:
        raise RuntimeError(
            "torch is required for ReID embedding. Install with: pip install mt-track[gpu]"
        ) from exc

    device = "cuda" if torch.cuda.is_available() else "cpu"

    db = ipc.get_worker_db_session()
    capture = None
    try:
        model, model_name = _load_model(torch, device, model_path)

        detections = (
            db.query(Detection)
            .outerjoin(Embedding, Embedding.detection_id == Detection.id)
            .filter(and_(Detection.video_id == video_id, Embedding.id.is_(None)))
            .order_by(Detection.frame_idx.asc(), Detection.id.asc())
            .all()
        )

        if not detections:
            log.info("No detections without embeddings for video %s", video_id)
            return

        video_path = ipc.get_video_path(db, video_id)
        capture = cv2.VideoCapture(video_path)
        if not capture.isOpened():
            raise RuntimeError(f"Failed to open video: {video_path}")

        total = len(detections)
        processed = 0

        for start_idx in range(0, len(detections), batch_size):
            batch = detections[start_idx : start_idx + batch_size]

            tensors = []
            valid_detections = []
            for det in batch:
                capture.set(cv2.CAP_PROP_POS_FRAMES, det.frame_idx)
                ok, frame = capture.read()
                if not ok:
                    continue

                x1 = max(0, int(round(det.x)))
                y1 = max(0, int(round(det.y)))
                x2 = min(frame.shape[1], int(round(det.x + det.w)))
                y2 = min(frame.shape[0], int(round(det.y + det.h)))
                if x2 <= x1 or y2 <= y1:
                    continue

                crop = frame[y1:y2, x1:x2]
                if crop.size == 0:
                    continue

                tensors.append(_prepare_tensor(torch, crop))
                valid_detections.append(det)

            if not tensors:
                processed += len(batch)
                reporter.update_progress(processed / total)
                if reporter.is_cancelled:
                    log.info("Embedding job %s cancelled", job_id)
                    return
                continue

            input_tensor = torch.stack(tensors).to(device)
            with torch.no_grad():
                output = model(input_tensor)
                if isinstance(output, (list, tuple)):
                    output = output[0]

            embeddings = output.detach().cpu().numpy().astype(np.float32)
            for det, vector in zip(valid_detections, embeddings):
                db.add(
                    Embedding(
                        detection_id=det.id,
                        vector=vector.tobytes(),
                        model_name=model_name,
                    )
                )

            db.commit()
            processed += len(batch)
            reporter.update_progress(processed / total)
            if reporter.is_cancelled:
                log.info("Embedding job %s cancelled", job_id)
                return
    except ImportError as exc:
        raise RuntimeError(
            "torchvision is required for fallback embedding model. Install torchvision or torchreid."
        ) from exc
    except Exception:
        db.rollback()
        raise
    finally:
        if capture is not None:
            capture.release()
        db.close()
