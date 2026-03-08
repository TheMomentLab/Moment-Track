import signal
import argparse
import os
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Start Moment Track services")
    _ = parser.add_argument("--no-worker", action="store_true", help="Do not launch GPU worker process")
    args = parser.parse_args()
    no_worker = bool(getattr(args, "no_worker", False))

    project_root = Path(__file__).resolve().parent.parent
    port = int(os.environ.get("MT_PORT", "8000"))

    # Start FastAPI server
    server_cmd = [
        sys.executable, "-m", "uvicorn",
        "backend.main:app",
        "--host", "0.0.0.0",
        "--port", str(port),
        "--reload",
    ]

    print(f"Starting Moment Track on http://localhost:{port}")

    server = None
    worker = None
    try:
        server = subprocess.Popen(server_cmd, cwd=str(project_root))
        if not no_worker:
            print("Starting GPU worker...")
            worker_cmd = [sys.executable, "-m", "worker.runner"]
            worker = subprocess.Popen(worker_cmd, cwd=str(project_root))

        _ = server.wait()
    except KeyboardInterrupt:
        pass
    finally:
        if server is not None and server.poll() is None:
            server.send_signal(signal.SIGTERM)
            _ = server.wait()

        if worker is not None and worker.poll() is None:
            worker.send_signal(signal.SIGTERM)
            _ = worker.wait()

        print("\nMoment Track stopped.")


if __name__ == "__main__":
    main()
