# Moment Track — API 명세서

> 버전: v0.1 (MVP)  
> 기본 경로: `/api/v1`  
> 요청/응답 포맷: `application/json`  
> 인증: 없음 (로컬 전용)  
> 에러 응답: `{ "detail": "string" }`

---

## 목차

1. [공통 규칙](#1-공통-규칙)
2. [Projects](#2-projects)
3. [Videos](#3-videos)
4. [Detections](#4-detections)
5. [Tracks](#5-tracks)
6. [Identities](#6-identities)
7. [Inference](#7-inference)
8. [Export](#8-export)

---

## 1. 공통 규칙

### HTTP 상태 코드

| 코드 | 의미 |
|---|---|
| `200` | 성공 (조회, 수정) |
| `201` | 생성 성공 |
| `204` | 성공 (응답 본문 없음 — 삭제) |
| `400` | 잘못된 요청 (파라미터 오류 등) |
| `404` | 리소스 없음 |
| `409` | 충돌 (병합 불가 조건 등) |
| `500` | 서버 내부 오류 |

### 페이지네이션 (목록 응답)

목록을 반환하는 엔드포인트는 공통 쿼리 파라미터를 지원한다.

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `limit` | integer | `100` | 최대 반환 수 |
| `offset` | integer | `0` | 시작 오프셋 |

응답 구조:
```json
{
  "total": 42,
  "items": [ ... ]
}
```

---

## 2. Projects

### `GET /api/v1/projects`

프로젝트 목록을 반환한다.

**응답 `200`**
```json
{
  "total": 2,
  "items": [
    {
      "id": 1,
      "name": "pedestrian_dataset",
      "classes": ["person", "vehicle"],
      "video_count": 3,
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T14:30:00Z"
    }
  ]
}
```

---

### `POST /api/v1/projects`

새 프로젝트를 생성한다.

**요청 본문**
```json
{
  "name": "pedestrian_dataset",
  "classes": ["person", "vehicle"]
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `name` | string | ✅ | 프로젝트 이름 |
| `classes` | string[] | ✅ | 어노테이션 클래스 목록 (최소 1개) |

**응답 `201`**
```json
{
  "id": 1,
  "name": "pedestrian_dataset",
  "classes": ["person", "vehicle"],
  "video_count": 0,
  "created_at": "2024-01-15T10:00:00Z",
  "updated_at": "2024-01-15T10:00:00Z"
}
```

---

### `GET /api/v1/projects/{project_id}`

프로젝트 상세 정보를 반환한다.

**응답 `200`**
```json
{
  "id": 1,
  "name": "pedestrian_dataset",
  "classes": ["person", "vehicle"],
  "video_count": 3,
  "created_at": "2024-01-15T10:00:00Z",
  "updated_at": "2024-01-15T14:30:00Z"
}
```

---

### `PATCH /api/v1/projects/{project_id}`

프로젝트 이름 또는 클래스 목록을 수정한다.

**요청 본문** (모든 필드 선택)
```json
{
  "name": "new_name",
  "classes": ["person", "vehicle", "bike"]
}
```

**응답 `200`** — 수정된 프로젝트 객체 반환

---

### `DELETE /api/v1/projects/{project_id}`

프로젝트와 관련 데이터를 모두 삭제한다.  
원본 비디오 파일은 삭제하지 않는다.

**응답 `204`**

---

## 3. Videos

### `GET /api/v1/projects/{project_id}/videos`

프로젝트에 속한 비디오 목록을 반환한다.

**응답 `200`**
```json
{
  "total": 2,
  "items": [
    {
      "id": 1,
      "project_id": 1,
      "file_path": "/home/user/videos/clip01.mp4",
      "camera_id": "default",
      "fps": 30.0,
      "width": 1920,
      "height": 1080,
      "total_frames": 900,
      "duration_sec": 30.0
    }
  ]
}
```

---

### `POST /api/v1/projects/{project_id}/videos`

프로젝트에 비디오를 추가한다.

**요청 본문**
```json
{
  "file_path": "/home/user/videos/clip01.mp4",
  "camera_id": "cam_front"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `file_path` | string | ✅ | 로컬 비디오 파일 절대 경로 |
| `camera_id` | string | ❌ | 카메라 식별자 (기본값: `"default"`) |

**응답 `201`** — 생성된 비디오 객체 반환 (fps, width, height, total_frames 자동 추출)

**에러**
- `400`: 파일이 존재하지 않거나 지원하지 않는 포맷

---

### `GET /api/v1/videos/{video_id}/frame/{frame_idx}`

특정 프레임 이미지를 JPEG로 반환한다.

**응답 `200`**
- Content-Type: `image/jpeg`
- 본문: JPEG 바이너리

**에러**
- `404`: `frame_idx`가 범위를 벗어남

---

### `GET /api/v1/videos/{video_id}/meta`

비디오 메타데이터를 반환한다.

**응답 `200`**
```json
{
  "id": 1,
  "fps": 30.0,
  "width": 1920,
  "height": 1080,
  "total_frames": 900,
  "duration_sec": 30.0,
  "camera_id": "default"
}
```

---

## 4. Detections

### `GET /api/v1/videos/{video_id}/detections`

프레임 범위 내 Detection 목록을 반환한다.

**쿼리 파라미터**

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `frame_start` | integer | `0` | 시작 프레임 (포함) |
| `frame_end` | integer | `total_frames` | 끝 프레임 (포함) |
| `track_id` | integer | — | 특정 Track만 필터 |

**응답 `200`**
```json
{
  "total": 120,
  "items": [
    {
      "id": 1,
      "track_id": 3,
      "video_id": 1,
      "frame_idx": 0,
      "x": 120.5,
      "y": 80.2,
      "w": 60.0,
      "h": 140.0,
      "confidence": 0.92,
      "class_name": "person",
      "is_keyframe": true,
      "is_interpolated": false,
      "source": "auto"
    }
  ]
}
```

---

### `POST /api/v1/videos/{video_id}/detections`

Detection을 수동으로 생성한다.

**요청 본문**
```json
{
  "frame_idx": 42,
  "x": 120.5,
  "y": 80.2,
  "w": 60.0,
  "h": 140.0,
  "class_name": "person",
  "track_id": 3,
  "is_keyframe": true
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `frame_idx` | integer | ✅ | |
| `x`, `y` | number | ✅ | 좌상단 좌표 (픽셀) |
| `w`, `h` | number | ✅ | 너비, 높이 (픽셀) |
| `class_name` | string | ✅ | |
| `track_id` | integer | ❌ | 미지정 시 자동으로 새 Track 생성 |
| `is_keyframe` | boolean | ❌ | 기본값 `true` |

**응답 `201`** — 생성된 Detection 객체 반환

---

### `PATCH /api/v1/detections/{detection_id}`

Detection 위치, 크기, 클래스를 수정한다.

**요청 본문** (모든 필드 선택)
```json
{
  "x": 125.0,
  "y": 82.0,
  "w": 58.0,
  "h": 138.0,
  "class_name": "person",
  "is_keyframe": false
}
```

**응답 `200`** — 수정된 Detection 객체 반환

---

### `DELETE /api/v1/detections/{detection_id}`

Detection을 삭제한다.  
삭제 후 해당 Track에 Detection이 없으면 Track도 자동 삭제된다.

**응답 `204`**

---

### `POST /api/v1/videos/{video_id}/detections/interpolate`

두 키프레임 사이 Detection을 선형 보간하여 생성한다.

**요청 본문**
```json
{
  "track_id": 3,
  "frame_start": 10,
  "frame_end": 30
}
```

**응답 `201`**
```json
{
  "created_count": 19,
  "detections": [ ... ]
}
```

**에러**
- `400`: `frame_start` 또는 `frame_end`에 키프레임이 없음
- `409`: 해당 구간에 이미 Detection이 존재함

---

## 5. Tracks

### `GET /api/v1/projects/{project_id}/tracks`

프로젝트 내 Track 목록을 반환한다.

**쿼리 파라미터**

| 파라미터 | 타입 | 설명 |
|---|---|---|
| `video_id` | integer | 특정 비디오로 필터 |
| `identity_id` | integer | 특정 Identity로 필터 |
| `unassigned` | boolean | `true` 시 Identity 미할당 Track만 반환 |

**응답 `200`**
```json
{
  "total": 10,
  "items": [
    {
      "id": 3,
      "identity_id": 1,
      "video_id": 1,
      "start_frame": 0,
      "end_frame": 120,
      "detection_count": 121,
      "source": "auto",
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

### `PATCH /api/v1/tracks/{track_id}`

Track의 Identity 할당을 변경한다.

**요청 본문**
```json
{
  "identity_id": 2
}
```

`identity_id`에 `null`을 전달하면 Identity 미할당 상태로 변경된다.

**응답 `200`** — 수정된 Track 객체 반환

---

### `POST /api/v1/tracks/merge`

두 Track을 하나로 병합한다.  
병합 후 `track_id_b`는 삭제된다.

**요청 본문**
```json
{
  "track_id_a": 3,
  "track_id_b": 7
}
```

**응답 `200`**
```json
{
  "merged_track": { ... }
}
```

**에러**
- `409`: 두 Track의 프레임 구간이 겹침

---

### `POST /api/v1/tracks/{track_id}/split`

Track을 특정 프레임 기준으로 두 개로 분리한다.

**요청 본문**
```json
{
  "split_frame": 60
}
```

분리 결과: `[0, split_frame-1]` / `[split_frame, end_frame]`

**응답 `201`**
```json
{
  "track_a": { ... },
  "track_b": { ... }
}
```

**에러**
- `400`: `split_frame`이 Track 범위 경계에 위치하여 분리 불가

---

### `DELETE /api/v1/tracks/{track_id}`

Track과 소속 Detection을 모두 삭제한다.

**응답 `204`**

---

## 6. Identities

### `GET /api/v1/projects/{project_id}/identities`

프로젝트 내 Identity 목록을 반환한다.

**응답 `200`**
```json
{
  "total": 5,
  "items": [
    {
      "id": 1,
      "project_id": 1,
      "label": "subject_A",
      "class_name": "person",
      "track_count": 2,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

### `POST /api/v1/projects/{project_id}/identities`

새 Identity를 생성한다.

**요청 본문**
```json
{
  "class_name": "person",
  "label": "subject_A"
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `class_name` | string | ✅ | |
| `label` | string | ❌ | 사용자 지정 이름 |

**응답 `201`** — 생성된 Identity 객체 반환

---

### `PATCH /api/v1/identities/{identity_id}`

Identity의 라벨 또는 클래스를 수정한다.

**요청 본문**
```json
{
  "label": "subject_B",
  "class_name": "person"
}
```

**응답 `200`** — 수정된 Identity 객체 반환

---

### `POST /api/v1/identities/merge`

두 Identity를 하나로 병합한다.  
`identity_id_b`의 모든 Track이 `identity_id_a`로 재할당되며 `identity_id_b`는 삭제된다.

**요청 본문**
```json
{
  "identity_id_a": 1,
  "identity_id_b": 3
}
```

**응답 `200`**
```json
{
  "merged_identity": { ... },
  "moved_track_count": 2
}
```

---

### `DELETE /api/v1/identities/{identity_id}`

Identity를 삭제한다.  
소속 Track은 삭제되지 않고 미할당(`identity_id = null`) 상태로 변경된다.

**응답 `204`**

---

### `GET /api/v1/identities/{identity_id}/crops`

Identity에 속한 Detection 크롭 이미지 목록을 반환한다.  
이미지 자체가 아닌 메타데이터 목록이며, 실제 이미지는 `/videos/{id}/frame/{idx}`로 별도 요청한다.

**쿼리 파라미터**

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `stride` | integer | `10` | N 프레임마다 1개 반환 |
| `keyframes_only` | boolean | `false` | 키프레임만 반환 |

**응답 `200`**
```json
{
  "total": 24,
  "items": [
    {
      "detection_id": 42,
      "video_id": 1,
      "frame_idx": 10,
      "track_id": 3,
      "bbox": { "x": 120.5, "y": 80.2, "w": 60.0, "h": 140.0 },
      "anomaly_score": 0.12
    }
  ]
}
```

`anomaly_score`는 ReID Embedding이 계산된 경우 동일 Identity 내 평균 거리 대비 이탈 정도 (0.0 = 정상, 1.0 = 이상).  
Embedding이 없으면 `null`.

---

## 7. Inference

### `POST /api/v1/inference/detect`

YOLO Detection 작업을 시작한다.

**요청 본문**
```json
{
  "video_id": 1,
  "frame_start": 0,
  "frame_end": 300,
  "model_path": "/home/user/models/yolov8n.pt",
  "classes": ["person"],
  "conf_threshold": 0.5,
  "iou_threshold": 0.45
}
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `video_id` | integer | ✅ | — | |
| `frame_start` | integer | ❌ | `0` | |
| `frame_end` | integer | ❌ | `total_frames` | |
| `model_path` | string | ✅ | — | 로컬 `.pt` 파일 경로 |
| `classes` | string[] | ❌ | 전체 클래스 | |
| `conf_threshold` | number | ❌ | `0.5` | |
| `iou_threshold` | number | ❌ | `0.45` | NMS IoU 임계값 |

**응답 `201`**
```json
{
  "job_id": 7,
  "status": "pending"
}
```

---

### `POST /api/v1/inference/track`

ByteTrack 작업을 시작한다.  
해당 비디오/프레임 범위의 Detection이 먼저 존재해야 한다.

**요청 본문**
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

| 필드 | 타입 | 필수 | 기본값 |
|---|---|---|---|
| `video_id` | integer | ✅ | — |
| `frame_start` | integer | ❌ | `0` |
| `frame_end` | integer | ❌ | `total_frames` |
| `track_thresh` | number | ❌ | `0.5` |
| `match_thresh` | number | ❌ | `0.8` |
| `track_buffer` | integer | ❌ | `30` |

**응답 `201`**
```json
{
  "job_id": 8,
  "status": "pending"
}
```

**에러**
- `400`: 해당 범위에 Detection이 없음

---

### `POST /api/v1/inference/embed`

ReID Embedding 계산 작업을 시작한다.

**요청 본문**
```json
{
  "video_id": 1,
  "model_path": "/home/user/models/osnet.pth",
  "batch_size": 64
}
```

| 필드 | 타입 | 필수 | 기본값 |
|---|---|---|---|
| `video_id` | integer | ✅ | — |
| `model_path` | string | ✅ | — |
| `batch_size` | integer | ❌ | `64` |

**응답 `201`**
```json
{
  "job_id": 9,
  "status": "pending"
}
```

---

### `GET /api/v1/inference/jobs/{job_id}`

작업 상태를 반환한다.

**응답 `200`**
```json
{
  "id": 7,
  "job_type": "detect",
  "status": "running",
  "progress": 0.62,
  "error_msg": null,
  "created_at": "2024-01-15T10:00:00Z",
  "finished_at": null
}
```

`status` 값: `"pending"` / `"running"` / `"done"` / `"error"`

---

### `GET /api/v1/inference/jobs/{job_id}/stream`

진행률을 SSE(Server-Sent Events)로 스트리밍한다.

**응답** — `text/event-stream`

```
data: {"progress": 0.10, "fps": 18.2, "eta_sec": 25}

data: {"progress": 0.62, "fps": 19.0, "eta_sec": 12}

data: {"progress": 1.0, "fps": 18.8, "eta_sec": 0, "status": "done"}
```

오류 발생 시:
```
data: {"status": "error", "error_msg": "CUDA out of memory"}
```

---

### `DELETE /api/v1/inference/jobs/{job_id}`

실행 중인 작업을 취소한다.  
취소 시점까지 완료된 결과는 DB에 저장된다.

**응답 `204`**

**에러**
- `409`: 이미 완료(`done`) 또는 오류(`error`) 상태인 작업

---

## 8. Export

### `POST /api/v1/projects/{project_id}/export/yolo`

YOLO 포맷으로 데이터셋을 내보낸다.

**요청 본문**
```json
{
  "video_ids": [1, 2],
  "classes": ["person", "vehicle"],
  "frame_start": 0,
  "frame_end": 900,
  "val_split": 0.2,
  "min_detections": 1,
  "conf_threshold": 0.3
}
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `video_ids` | integer[] | ❌ | 전체 | 포함할 비디오 |
| `classes` | string[] | ❌ | 전체 | |
| `frame_start` | integer | ❌ | `0` | |
| `frame_end` | integer | ❌ | `total_frames` | |
| `val_split` | number | ❌ | `0.2` | validation 비율 (0.0~1.0) |
| `min_detections` | integer | ❌ | `1` | 미만 트랙 제외 |
| `conf_threshold` | number | ❌ | `0.0` | 미만 Detection 제외 |

**응답 `201`**
```json
{
  "output_path": "/home/user/.mt_track/projects/1/exports/yolo_20240115_143022",
  "frame_count": 840,
  "detection_count": 1204
}
```

---

### `POST /api/v1/projects/{project_id}/export/mot`

MOT Challenge 포맷으로 데이터셋을 내보낸다.

**요청 본문**
```json
{
  "video_ids": [1],
  "classes": ["person"],
  "frame_start": 0,
  "frame_end": 900,
  "min_detections": 5,
  "conf_threshold": 0.3
}
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `video_ids` | integer[] | ❌ | 전체 | |
| `classes` | string[] | ❌ | 전체 | |
| `frame_start` | integer | ❌ | `0` | |
| `frame_end` | integer | ❌ | `total_frames` | |
| `min_detections` | integer | ❌ | `1` | 미만 트랙 제외 |
| `conf_threshold` | number | ❌ | `0.0` | |

**응답 `201`**
```json
{
  "output_path": "/home/user/.mt_track/projects/1/exports/mot_20240115_143022",
  "frame_count": 900,
  "track_count": 8,
  "detection_count": 1050
}
```
