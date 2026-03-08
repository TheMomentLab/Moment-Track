# Moment Track — 아키텍처 설계

> 버전: v0.1 (MVP)  
> 작성 기준: 기획서 `01-planning.md`, 기능명세서 `02-features.md` 기반

---

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [컴포넌트 구성](#2-컴포넌트-구성)
3. [데이터 모델 (DB 스키마)](#3-데이터-모델-db-스키마)
4. [API 설계](#4-api-설계)
5. [AI 워커 설계](#5-ai-워커-설계)
6. [프론트엔드 구성](#6-프론트엔드-구성)
7. [디렉토리 구조](#7-디렉토리-구조)
8. [실행 방식](#8-실행-방식)

---

## 1. 시스템 개요

### 1.1 전체 구성도

```
┌─────────────────────────────────────────────────┐
│                 Browser (React)                 │
│  VideoViewer │ AnnotationEditor │ CropGallery   │
└──────────────────────┬──────────────────────────┘
                       │ HTTP REST / SSE
                       ▼
┌─────────────────────────────────────────────────┐
│             API Server (FastAPI)                │
│  /projects  /videos  /tracks  /identities       │
│  /inference  /export                           │
└────────┬────────────────────────────────────────┘
         │                        │
         ▼                        ▼
  ┌─────────────┐        ┌─────────────────────┐
  │  SQLite DB  │        │   GPU Worker        │
  │  (단일 파일) │        │  (별도 프로세스)      │
  └─────────────┘        │  YOLO / ByteTrack   │
                         │  ReID Embedding     │
                         └──────────┬──────────┘
                                    │
                                    ▼
                             ┌─────────────┐
                             │  Local GPU  │
                             │  (CUDA)     │
                             └─────────────┘
```

### 1.2 설계 원칙

| 원칙 | 내용 |
|---|---|
| **로컬 퍼스트** | 외부 서비스 의존 없음. 모든 처리는 로컬에서 |
| **프로세스 분리** | API 서버와 GPU 워커를 분리하여 워커 크래시가 서버에 영향 없음 |
| **단순성** | SQLite 단일 파일 DB. 별도 DB 서버 불필요 |
| **확장 가능성** | 멀티 카메라, 협업 등 향후 기능을 위한 스키마 여유 확보 |

---

## 2. 컴포넌트 구성

### 2.1 API 서버 (FastAPI)

**역할**: 프론트엔드의 모든 요청을 처리하는 단일 진입점.

| 모듈 | 책임 |
|---|---|
| `routers/projects` | 프로젝트 CRUD |
| `routers/videos` | 비디오 메타데이터 조회, 프레임 서빙 |
| `routers/annotations` | Detection / Track / Identity CRUD |
| `routers/inference` | AI 워커 작업 요청 및 상태 조회 |
| `routers/export` | 데이터셋 내보내기 |
| `services/` | 비즈니스 로직 (병합, 분리, 보간) |
| `db/` | SQLite 연결, 마이그레이션 |
| `worker_client/` | GPU 워커와의 IPC 통신 |

**프레임 서빙 방식**: `cv2.VideoCapture`로 원본 비디오에서 프레임을 직접 추출하여 JPEG로 응답. 전체 비디오를 미리 디코딩하지 않음.

### 2.2 GPU 워커

**역할**: AI 인퍼런스 전담. API 서버와 IPC(프로세스 간 통신)로 연결.

| 모듈 | 책임 |
|---|---|
| `runner.py` | 워커 진입점, 태스크 큐 소비 |
| `tasks/detect.py` | YOLO 인퍼런스 |
| `tasks/track.py` | ByteTrack 처리 |
| `tasks/embed.py` | ReID Embedding 계산 |
| `ipc.py` | API 서버와의 통신 (소켓 기반) |
| `progress.py` | 진행률 SSE 이벤트 발행 |

**통신 구조**:
```
API Server ──[Task Request / JSON]──► GPU Worker
API Server ◄──[Progress Events / SSE]── GPU Worker
API Server ◄──[Result / JSON]──────── GPU Worker
```

### 2.3 프론트엔드 (React)

**역할**: 어노테이션 UI 전체. API 서버와 REST + SSE로 통신.

주요 컴포넌트는 [6. 프론트엔드 구성](#6-프론트엔드-구성) 참조.

---

## 3. 데이터 모델 (DB 스키마)

### 3.1 ERD (개념)

```
Project
  └─ Video (1:N)
       └─ Frame (1:N, 필요시 메타만 저장)
Identity
  └─ Track (1:N)  ──── Video (N:1)
       └─ Detection (1:N) ──── Frame
                └─ Embedding (0:1)
```

### 3.2 테이블 정의

#### `projects`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | 프로젝트 이름 |
| `classes` | TEXT | JSON 배열 (예: `["person","vehicle"]`) |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

#### `videos`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | INTEGER PK | |
| `project_id` | INTEGER FK | |
| `file_path` | TEXT | 로컬 파일 절대 경로 |
| `camera_id` | TEXT | 향후 멀티 카메라 확장용 (기본값: `"default"`) |
| `fps` | REAL | |
| `width` | INTEGER | |
| `height` | INTEGER | |
| `total_frames` | INTEGER | |
| `duration_sec` | REAL | |

#### `identities`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | INTEGER PK | |
| `project_id` | INTEGER FK | |
| `label` | TEXT | 사용자 지정 라벨 (선택) |
| `class_name` | TEXT | |
| `created_at` | DATETIME | |

#### `tracks`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | INTEGER PK | |
| `identity_id` | INTEGER FK | NULL 허용 (미할당) |
| `video_id` | INTEGER FK | |
| `start_frame` | INTEGER | |
| `end_frame` | INTEGER | |
| `source` | TEXT | `"manual"` / `"auto"` |
| `created_at` | DATETIME | |

#### `detections`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | INTEGER PK | |
| `track_id` | INTEGER FK | NULL 허용 (트랙 미할당) |
| `video_id` | INTEGER FK | |
| `frame_idx` | INTEGER | |
| `x` | REAL | 좌상단 x (픽셀) |
| `y` | REAL | 좌상단 y (픽셀) |
| `w` | REAL | 너비 (픽셀) |
| `h` | REAL | 높이 (픽셀) |
| `confidence` | REAL | |
| `class_name` | TEXT | |
| `is_keyframe` | BOOLEAN | |
| `is_interpolated` | BOOLEAN | |
| `source` | TEXT | `"manual"` / `"auto"` |

#### `embeddings`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | INTEGER PK | |
| `detection_id` | INTEGER FK UNIQUE | |
| `vector` | BLOB | numpy array → bytes (float32) |
| `model_name` | TEXT | 어떤 모델로 추출했는지 |

#### `inference_jobs`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | INTEGER PK | |
| `project_id` | INTEGER FK | |
| `video_id` | INTEGER FK | |
| `job_type` | TEXT | `"detect"` / `"track"` / `"embed"` |
| `status` | TEXT | `"pending"` / `"running"` / `"done"` / `"error"` |
| `params` | TEXT | JSON |
| `progress` | REAL | 0.0 ~ 1.0 |
| `error_msg` | TEXT | |
| `created_at` | DATETIME | |
| `finished_at` | DATETIME | |

---

## 4. API 설계

### 규칙

- 기본 경로: `/api/v1`
- 요청/응답 포맷: JSON
- 인증: 없음 (로컬 전용)
- 에러 응답: `{ "detail": "message" }`

### 4.1 프로젝트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/projects` | 프로젝트 목록 |
| `POST` | `/projects` | 프로젝트 생성 |
| `GET` | `/projects/{id}` | 프로젝트 상세 |
| `PATCH` | `/projects/{id}` | 프로젝트 수정 |
| `DELETE` | `/projects/{id}` | 프로젝트 삭제 |

### 4.2 비디오 / 프레임

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/projects/{id}/videos` | 비디오 목록 |
| `POST` | `/projects/{id}/videos` | 비디오 추가 |
| `GET` | `/videos/{id}/frame/{frame_idx}` | 프레임 이미지 (JPEG) |
| `GET` | `/videos/{id}/meta` | 비디오 메타 (fps, 해상도 등) |

### 4.3 어노테이션

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/videos/{id}/detections` | 프레임 범위 내 Detection 목록 |
| `POST` | `/videos/{id}/detections` | Detection 생성 |
| `PATCH` | `/detections/{id}` | Detection 수정 |
| `DELETE` | `/detections/{id}` | Detection 삭제 |
| `GET` | `/projects/{id}/tracks` | Track 목록 |
| `POST` | `/tracks/merge` | Track 병합 |
| `POST` | `/tracks/{id}/split` | Track 분리 |
| `GET` | `/projects/{id}/identities` | Identity 목록 |
| `POST` | `/projects/{id}/identities` | Identity 생성 |
| `PATCH` | `/identities/{id}` | Identity 수정 |
| `POST` | `/identities/merge` | Identity 병합 |

### 4.4 AI 인퍼런스

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/inference/detect` | YOLO Detection 작업 시작 |
| `POST` | `/inference/track` | ByteTrack 작업 시작 |
| `POST` | `/inference/embed` | ReID Embedding 계산 시작 |
| `GET` | `/inference/jobs/{id}` | 작업 상태 조회 |
| `DELETE` | `/inference/jobs/{id}` | 작업 취소 |
| `GET` | `/inference/jobs/{id}/stream` | 진행률 SSE 스트림 |

### 4.5 내보내기

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/projects/{id}/export/yolo` | YOLO 포맷 내보내기 |
| `POST` | `/projects/{id}/export/mot` | MOT Challenge 포맷 내보내기 |

---

## 5. AI 워커 설계

### 5.1 워커 시작 / 종료

API 서버가 시작될 때 GPU 워커를 `subprocess`로 실행한다.  
API 서버 종료 시 워커에 SIGTERM을 전송하고 정상 종료를 기다린다.

```
API Server 시작
  └─► subprocess.Popen(["python", "worker/runner.py"])
      └─► 워커: 소켓 리슨 시작
```

### 5.2 작업 흐름

```
1. 클라이언트 → POST /inference/detect (params)
2. API Server → DB에 job 레코드 생성 (status=pending)
3. API Server → Worker에 작업 전송 (IPC 소켓)
4. Worker → 작업 수신 → status=running 업데이트
5. Worker → 인퍼런스 루프
     → 매 N 프레임마다 progress 업데이트
     → SSE 이벤트로 프론트엔드에 전달
6. Worker → 인퍼런스 완료 → 결과를 DB에 저장
7. Worker → status=done 업데이트
```

### 5.3 인퍼런스 파라미터

#### YOLO Detection
```json
{
  "video_id": 1,
  "frame_start": 0,
  "frame_end": 300,
  "model_path": "/path/to/yolov8n.pt",
  "classes": ["person"],
  "conf_threshold": 0.5,
  "iou_threshold": 0.45
}
```

#### ByteTrack
```json
{
  "video_id": 1,
  "frame_start": 0,
  "frame_end": 300,
  "track_thresh": 0.5,
  "match_thresh": 0.8,
  "track_buffer": 30
}
```

#### ReID Embedding
```json
{
  "video_id": 1,
  "model_path": "/path/to/osnet.pth",
  "batch_size": 64
}
```

### 5.4 CUDA / CPU Fallback

워커 시작 시 CUDA 가용 여부를 확인하고, 없으면 CPU로 자동 전환.

```python
device = "cuda" if torch.cuda.is_available() else "cpu"
```

---

## 6. 프론트엔드 구성

### 6.1 페이지 구조

```
/                    → ProjectList (프로젝트 목록)
/projects/new        → ProjectCreate (프로젝트 생성)
/projects/:id        → ProjectWorkspace (메인 작업 화면)
  └─ /videos/:vid    → VideoAnnotator (비디오 어노테이션)
```

### 6.2 VideoAnnotator 레이아웃

```
┌────────────────────────────────────────────────────────────┐
│  TopBar: 프로젝트명 | 비디오명 | 저장 상태 | AI 워커 상태     │
├──────────────────────────────┬─────────────────────────────┤
│                              │  SidePanel                  │
│   VideoCanvas                │  ┌─ TrackList              │
│   - 프레임 렌더링             │  │  (트랙/Identity 목록)    │
│   - 바운딩 박스 오버레이      │  └─ PropertiesPanel        │
│   - 선택/편집 인터랙션        │     (선택 객체 속성)        │
│                              │                             │
├──────────────────────────────┴─────────────────────────────┤
│  Timeline                                                   │
│  - 스크러버, 트랙 구간 바, 키프레임 마커                      │
├─────────────────────────────────────────────────────────────┤
│  ControlBar: 재생 | 속도 | 프레임 번호 | 도구 선택           │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 CropGallery 레이아웃

```
┌─────────────────────────────────────────────────────────────┐
│  FilterBar: Identity ID | 클래스 | 프레임 범위               │
├────────────────────┬────────────────────────────────────────┤
│  IdentityList      │  CropGrid                              │
│  (사이드 목록)      │  - N×N 크롭 썸네일 그리드               │
│                    │  - 이상 크롭 경고 표시                  │
│                    │  - 클릭 시 비디오 이동                  │
└────────────────────┴────────────────────────────────────────┘
```

### 6.4 주요 상태 관리

전역 상태는 **Zustand** 사용 (가볍고 React 친화적).

| 스토어 | 관리 데이터 |
|---|---|
| `projectStore` | 현재 프로젝트 정보, 클래스 목록 |
| `annotationStore` | 현재 프레임 Detection, 선택된 트랙/Identity |
| `videoStore` | 현재 프레임 번호, 재생 상태, FPS |
| `workerStore` | AI 작업 진행 상태, SSE 연결 |

---

## 7. 디렉토리 구조

```
mt_track/                        # 모노레포 루트
│
├── backend/                     # FastAPI 서버
│   ├── main.py                  # 앱 진입점
│   ├── routers/
│   │   ├── projects.py
│   │   ├── videos.py
│   │   ├── annotations.py
│   │   ├── inference.py
│   │   └── export.py
│   ├── services/
│   │   ├── annotation_service.py
│   │   ├── export_service.py
│   │   └── worker_client.py
│   ├── db/
│   │   ├── database.py
│   │   ├── models.py
│   │   └── migrations/
│   └── schemas/                 # Pydantic 스키마
│
├── worker/                      # GPU 인퍼런스 워커
│   ├── runner.py                # 워커 진입점
│   ├── ipc.py
│   ├── tasks/
│   │   ├── detect.py
│   │   ├── track.py
│   │   └── embed.py
│   └── models/                  # 모델 로더
│
├── frontend/                    # React 앱
│   ├── src/
│   │   ├── pages/
│   │   │   ├── ProjectList.tsx
│   │   │   ├── ProjectCreate.tsx
│   │   │   └── workspace/
│   │   │       ├── VideoAnnotator.tsx
│   │   │       └── CropGallery.tsx
│   │   ├── components/
│   │   │   ├── VideoCanvas.tsx
│   │   │   ├── Timeline.tsx
│   │   │   ├── TrackList.tsx
│   │   │   └── CropGrid.tsx
│   │   ├── stores/              # Zustand
│   │   └── api/                 # API 클라이언트
│   └── package.json
│
├── docs/                        # 설계 문서
│   ├── 01-planning.md
│   ├── 02-features.md
│   ├── 03-architecture.md
│   └── 04-interface.md
│
├── scripts/
│   └── start.py                 # 서버 + 워커 동시 실행
│
└── README.md
```

---

## 8. 실행 방식

### 8.1 사용자 실행 흐름

```bash
# 1. 의존성 설치
pip install -r requirements.txt
cd frontend && npm install

# 2. 실행 (단일 커맨드)
python scripts/start.py

# 결과:
# - FastAPI 서버: http://localhost:8000
# - GPU 워커: 백그라운드 프로세스
# - 브라우저 자동 열기: http://localhost:8000
```

### 8.2 `start.py` 동작

```
start.py
  ├─► frontend 빌드 (첫 실행 시만)
  ├─► GPU 워커 subprocess 실행
  ├─► FastAPI uvicorn 실행
  └─► 브라우저 자동 열기
```

### 8.3 포트 설정

| 서비스 | 기본 포트 | 환경변수 |
|---|---|---|
| FastAPI | 8000 | `MT_PORT` |
| GPU 워커 IPC | 내부 소켓 | 고정 |

### 8.4 데이터 저장 위치

```
~/.mt_track/
  └── projects/
        └── {project_id}/
              ├── project.db    # SQLite
              └── exports/      # 내보내기 결과
```
