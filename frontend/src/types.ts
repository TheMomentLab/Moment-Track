/**
 * Shared domain types mirroring backend Pydantic schemas.
 */

export interface Detection {
  id: number
  track_id: number | null
  video_id: number
  frame_idx: number
  x: number
  y: number
  w: number
  h: number
  confidence: number | null
  class_name: string
  is_keyframe: boolean
  is_interpolated: boolean
  source: string
}

export interface Identity {
  id: number
  project_id: number
  label: string | null
  class_name: string
  track_count: number
  created_at: string
}

export interface Track {
  id: number
  identity_id: number | null
  video_id: number
  start_frame: number
  end_frame: number
  detection_count: number
  source: string
  created_at: string
}

export interface VideoMeta {
  id: number
  fps: number
  width: number
  height: number
  total_frames: number
  duration_sec: number
  camera_id: string
}

export interface Project {
  id: number
  name: string
  classes: string[]
  created_at: string
}

export type Tool = "select" | "box" | "keyframe"
