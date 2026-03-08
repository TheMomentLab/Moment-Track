"""Project business logic."""

import json

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.db.models import Detection, Project, Video
from backend.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate


def _serialize(project: Project, db: Session) -> ProjectRead:
    total_frames = sum(v.total_frames for v in project.videos)
    annotated_frames = (
        db.query(func.count(func.distinct(Detection.frame_idx)))
        .join(Video)
        .filter(Video.project_id == project.id)
        .scalar()
        or 0
    )
    return ProjectRead(
        id=project.id,
        name=project.name,
        classes=json.loads(project.classes),
        video_count=len(project.videos),
        total_frames=total_frames,
        annotated_frames=annotated_frames,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def list_projects(db: Session, limit: int, offset: int) -> tuple[int, list[ProjectRead]]:
    total = db.query(Project).count()
    rows = db.query(Project).order_by(Project.created_at.desc()).offset(offset).limit(limit).all()
    return total, [_serialize(r, db) for r in rows]


def create_project(db: Session, body: ProjectCreate) -> ProjectRead:
    project = Project(
        name=body.name,
        classes=json.dumps(body.classes),
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return _serialize(project, db)


def get_project(db: Session, project_id: int) -> ProjectRead | None:
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        return None
    return _serialize(project, db)


def update_project(db: Session, project_id: int, body: ProjectUpdate) -> ProjectRead | None:
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        return None
    if body.name is not None:
        project.name = body.name
    if body.classes is not None:
        project.classes = json.dumps(body.classes)
    db.commit()
    db.refresh(project)
    return _serialize(project, db)


def delete_project(db: Session, project_id: int) -> bool:
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        return False
    db.delete(project)
    db.commit()
    return True
