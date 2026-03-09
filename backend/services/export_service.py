"""Export service — YOLO detection format and MOT Challenge format export."""

import csv
import json
import os
from pathlib import Path

from sqlalchemy.orm import Session

from backend.config import settings
from backend.db.models import Detection, Project, Track, Video
from backend.schemas.export import ExportResponse, MotExportRequest, YoloExportRequest


def _export_dir(project_id: int) -> Path:
    p = settings.export_root / str(project_id) / "exports"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _get_videos(db: Session, project_id: int, video_ids: list[int] | None) -> list[Video]:
    q = db.query(Video).filter(Video.project_id == project_id)
    if video_ids:
        q = q.filter(Video.id.in_(video_ids))
    return q.all()


def _filter_detections(
    db: Session,
    video_ids: list[int],
    classes: list[str] | None,
    frame_start: int,
    frame_end: int | None,
    conf_threshold: float,
    min_detections: int,
) -> list[Detection]:
    q = (
        db.query(Detection)
        .filter(Detection.video_id.in_(video_ids))
        .filter(Detection.frame_idx >= frame_start)
    )
    if frame_end is not None:
        q = q.filter(Detection.frame_idx <= frame_end)
    if classes:
        q = q.filter(Detection.class_name.in_(classes))
    if conf_threshold > 0:
        q = q.filter(
            (Detection.confidence == None) | (Detection.confidence >= conf_threshold)  # noqa: E711
        )

    dets = q.order_by(Detection.video_id, Detection.frame_idx).all()

    if min_detections > 1:
        # filter by track detection count
        from collections import Counter
        track_counts: Counter[int | None] = Counter(d.track_id for d in dets)
        dets = [d for d in dets if d.track_id is None or track_counts[d.track_id] >= min_detections]

    return dets


# ─────────────────────────── YOLO ───────────────────────────


def export_yolo(db: Session, project_id: int, body: YoloExportRequest) -> ExportResponse:
    """Export in YOLO detection format.

    Output structure:
      exports/yolo_{timestamp}/
        data.yaml
        images/train/  (symlinks or paths listed in train.txt)
        labels/train/  <video_id>_<frame>.txt
        train.txt
        val.txt
    """
    import time

    project: Project | None = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    project_classes: list[str] = json.loads(project.classes)

    videos = _get_videos(db, project_id, body.video_ids)
    if not videos:
        raise ValueError("No videos found for export")
    video_map = {v.id: v for v in videos}

    dets = _filter_detections(
        db,
        [v.id for v in videos],
        body.classes,
        body.frame_start,
        body.frame_end,
        body.conf_threshold,
        body.min_detections,
    )

    if not dets:
        raise ValueError("No detections match the export criteria")

    # determine class list (either from project or from detections)
    export_classes = body.classes if body.classes else project_classes
    if not export_classes:
        export_classes = sorted({d.class_name for d in dets})
    class_idx = {c: i for i, c in enumerate(export_classes)}

    timestamp = int(time.time())
    out_dir = _export_dir(project_id) / f"yolo_{timestamp}"
    labels_train = out_dir / "labels" / "train"
    labels_val = out_dir / "labels" / "val"
    images_train = out_dir / "images" / "train"
    images_val = out_dir / "images" / "val"
    for d in [labels_train, labels_val, images_train, images_val]:
        d.mkdir(parents=True, exist_ok=True)

    # group detections by (video_id, frame_idx)
    from collections import defaultdict
    frame_dets: dict[tuple[int, int], list[Detection]] = defaultdict(list)
    for det in dets:
        frame_dets[(det.video_id, det.frame_idx)].append(det)

    frames = sorted(frame_dets.keys())
    total_frames = len(frames)
    val_count = max(1, int(total_frames * body.val_split))
    val_set = set(frames[-val_count:])

    train_txt_lines: list[str] = []
    val_txt_lines: list[str] = []

    for vid_id, frame_idx in frames:
        video = video_map[vid_id]
        W, H = video.width, video.height
        stem = f"{vid_id}_{frame_idx:06d}"
        is_val = (vid_id, frame_idx) in val_set
        label_dir = labels_val if is_val else labels_train
        images_dir = images_val if is_val else images_train

        # write label file
        label_path = label_dir / f"{stem}.txt"
        with open(label_path, "w") as f:
            for det in frame_dets[(vid_id, frame_idx)]:
                cls = class_idx.get(det.class_name)
                if cls is None:
                    continue
                # YOLO format: class cx cy w h (normalized)
                cx = (det.x + det.w / 2) / W
                cy = (det.y + det.h / 2) / H
                nw = det.w / W
                nh = det.h / H
                f.write(f"{cls} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}\n")

        # image path entry (actual frame extraction not done here — point to source video + frame)
        img_path = images_dir / f"{stem}.jpg"
        img_entry = str(img_path)
        if is_val:
            val_txt_lines.append(img_entry)
        else:
            train_txt_lines.append(img_entry)

    # write manifest files
    (out_dir / "train.txt").write_text("\n".join(train_txt_lines))
    (out_dir / "val.txt").write_text("\n".join(val_txt_lines))

    # write data.yaml
    data_yaml = {
        "path": str(out_dir),
        "train": "train.txt",
        "val": "val.txt",
        "names": {i: c for i, c in enumerate(export_classes)},
        "nc": len(export_classes),
    }
    import yaml  # pyyaml is a transitive dep of many packages; fall back to json if missing
    try:
        (out_dir / "data.yaml").write_text(yaml.dump(data_yaml, allow_unicode=True))
    except ImportError:
        (out_dir / "data.yaml").write_text(json.dumps(data_yaml, indent=2, ensure_ascii=False))

    return ExportResponse(
        output_path=str(out_dir),
        frame_count=total_frames,
        detection_count=len(dets),
        track_count=None,
    )


# ─────────────────────────── MOT ───────────────────────────


def export_mot(db: Session, project_id: int, body: MotExportRequest) -> ExportResponse:
    """Export in MOT Challenge format.

    Output structure:
      exports/mot_{timestamp}/
        {video_id}/
          gt/gt.txt          # frame,id,x,y,w,h,conf,cls,vis
          seqinfo.ini
    """
    import configparser
    import time

    project: Project | None = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    videos = _get_videos(db, project_id, body.video_ids)
    if not videos:
        raise ValueError("No videos found for export")
    video_map = {v.id: v for v in videos}

    dets = _filter_detections(
        db,
        [v.id for v in videos],
        body.classes,
        body.frame_start,
        body.frame_end,
        body.conf_threshold,
        body.min_detections,
    )

    if not dets:
        raise ValueError("No detections match the export criteria")

    # build track_id → identity_id map
    track_rows = (
        db.query(Track)
        .filter(Track.video_id.in_([v.id for v in videos]))
        .all()
    )
    track_to_identity: dict[int, int | None] = {t.id: t.identity_id for t in track_rows}

    # assign MOT integer IDs: use track_id directly (1-based)
    timestamp = int(time.time())
    out_dir = _export_dir(project_id) / f"mot_{timestamp}"

    total_det_count = 0
    track_ids_seen: set[int] = set()

    for video in videos:
        vid_dets = [d for d in dets if d.video_id == video.id]
        if not vid_dets:
            continue

        seq_dir = out_dir / str(video.id)
        gt_dir = seq_dir / "gt"
        gt_dir.mkdir(parents=True, exist_ok=True)

        gt_path = gt_dir / "gt.txt"
        with open(gt_path, "w", newline="") as f:
            writer = csv.writer(f)
            for det in sorted(vid_dets, key=lambda d: (d.frame_idx, d.track_id or 0)):
                mot_id = det.track_id if det.track_id is not None else -1
                if mot_id > 0:
                    track_ids_seen.add(mot_id)
                # MOT format: frame(1-based), id, x, y, w, h, conf, class, visibility
                writer.writerow([
                    det.frame_idx + 1,  # MOT uses 1-based frames
                    mot_id,
                    round(det.x, 2),
                    round(det.y, 2),
                    round(det.w, 2),
                    round(det.h, 2),
                    round(det.confidence, 4) if det.confidence is not None else 1,
                    1,  # class id (MOT uses 1 for pedestrian)
                    1,  # visibility
                ])
            total_det_count += len(vid_dets)

        # seqinfo.ini
        ini = configparser.ConfigParser()
        ini["Sequence"] = {
            "name": f"video_{video.id}",
            "imDir": "img1",
            "frameRate": str(int(round(video.fps))),
            "seqLength": str(video.total_frames),
            "imWidth": str(video.width),
            "imHeight": str(video.height),
            "imExt": ".jpg",
        }
        with open(seq_dir / "seqinfo.ini", "w") as f:
            ini.write(f)

    return ExportResponse(
        output_path=str(out_dir),
        frame_count=len({(d.video_id, d.frame_idx) for d in dets}),
        detection_count=total_det_count,
        track_count=len(track_ids_seen),
    )
