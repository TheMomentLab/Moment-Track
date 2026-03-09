"""GPU Worker - HTTP server entry point on port 8001."""

from __future__ import annotations

import logging
import threading
from typing import TypeAlias

import uvicorn
from fastapi import FastAPI

from backend.config import settings
from worker.ipc import JobReporter
from worker.tasks.detect import run_detect
from worker.tasks.embed import run_embed
from worker.tasks.track import run_track

log = logging.getLogger(__name__)

TaskParam: TypeAlias = int | float | str | list[str] | None
TaskPayload: TypeAlias = dict[str, TaskParam]


def _probe_optional_packages() -> None:
    for package_name in ("torch", "ultralytics"):
        try:
            __import__(package_name)
        except ImportError as exc:
            log.warning(
                "Optional GPU package '%s' is not installed: %s. Worker will start, but related tasks may fail.",
                package_name,
                exc,
            )


app = FastAPI(title="Moment Track GPU Worker")


def _run_job(payload: TaskPayload) -> None:
    raw_job_id = payload.get("job_id")
    if not isinstance(raw_job_id, (int, float, str)):
        raise ValueError("job_id is required")
    job_id = int(raw_job_id)

    task_type = str(payload.get("type", ""))
    if not task_type:
        raise ValueError("type is required")

    reporter = JobReporter(job_id)
    try:
        reporter.start()

        if task_type == "detect":
            run_detect(job_id, payload, reporter)
        elif task_type == "track":
            run_track(job_id, payload, reporter)
        elif task_type == "embed":
            run_embed(job_id, payload, reporter)
        else:
            raise ValueError(f"Unknown task type: {task_type}")

        if reporter.is_cancelled:
            log.info("Job %s was cancelled", job_id)
            return
        reporter.complete()
    except Exception as exc:
        log.exception("Job %s failed", job_id)
        reporter.fail(str(exc))
    finally:
        reporter.close()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/run")
def run(payload: TaskPayload) -> dict[str, str]:
    task_payload = dict(payload)
    worker_thread = threading.Thread(target=_run_job, args=(task_payload,), daemon=True)
    worker_thread.start()
    return {"status": "accepted"}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
    _probe_optional_packages()
    log.info("Moment Track GPU Worker started on port %d", settings.worker_port)
    uvicorn.run(app, host=settings.worker_host, port=settings.worker_port)


if __name__ == "__main__":
    main()
