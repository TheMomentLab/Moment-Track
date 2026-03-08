# Moment Track

Video annotation tool for MOT/ReID dataset creation.
Identity as a first-class object — not just "images in a sequence."

## Why Moment Track?

Existing annotation tools (CVAT, Label Studio, etc.) treat video as a series of independent images. This makes multi-object tracking and re-identification workflows painful:

- No concept of **Identity** across tracks
- No support for **track merge/split** or identity switch correction
- No **ReID crop gallery** for visual verification
- Cloud dependency for AI-assisted labeling

Moment Track treats video as a **graph of time and identity**, with a data model designed from the ground up for MOT/ReID:

```
Identity (real-world object)
 ├─ Track 1 (frames 0–120)
 ├─ Track 2 (frames 300–420)
 └─ Track 3 (camera B)
```

## Key Features

- **Video-native annotation** — timeline scrubbing, keyframe interpolation, track visualization
- **Track / Identity management** — merge, split, reassign tracks across identities
- **ReID Crop Gallery** — per-identity crop grid, visual comparison, anomaly detection
- **Local GPU inference** — YOLO detection + ByteTrack tracking, no cloud required
- **Dataset export** — YOLO and MOT Challenge formats

## Quick Start

```bash
# Clone and install backend
git clone https://github.com/jinhyuk2me/mt-track.git
cd mt-track
pip install -e ".[dev]"

# Install frontend
cd frontend && npm install && cd ..

# Run
python scripts/start.py
```

Open http://localhost:8000

### GPU Support (optional)

```bash
pip install -e ".[gpu]"   # torch + ultralytics
```

## Project Structure

```
mt_track/
├── backend/         # FastAPI server (API, DB, services)
├── worker/          # GPU inference worker (YOLO, ByteTrack, ReID)
├── frontend/        # React + TypeScript app (Vite, Tailwind, shadcn/ui)
├── scripts/         # Launch scripts
└── docs/            # Design documents (planning, features, architecture, API, UI)
```

## Tech Stack

| Layer | Stack |
|---|---|
| **Backend** | Python 3.10+ / FastAPI / SQLAlchemy / SQLite |
| **Frontend** | React / TypeScript / Vite / Tailwind CSS / shadcn/ui |
| **AI Worker** | YOLO (detection) / ByteTrack (tracking) / ReID embeddings |
| **Communication** | REST API + Server-Sent Events (SSE) |

## Requirements

- Python 3.10+
- Node.js 18+
- CUDA 11.8+ (optional, for GPU inference)

## License

MIT
