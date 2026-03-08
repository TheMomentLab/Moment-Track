/**
 * Timeline — 프레임 스크러버 (클릭/드래그 탐색)
 */
import { useCallback, useMemo, useRef, useState } from "react"
import type { Detection } from "@/types"

interface TrackInfo {
  id: number
  identity_id: number | null
  start_frame: number
  end_frame: number
}

interface IdentityInfo {
  id: number
  label: string | null
  class_name: string
}

const IDENTITY_PALETTE = [
  "#FF6B6B",
  "#4ECDC4",
  "#FFE66D",
  "#6C5CE7",
  "#A29BFE",
  "#FD79A8",
  "#00B894",
  "#E17055",
]

interface Props {
  currentFrame: number
  totalFrames: number
  fps: number
  detections: Detection[] // 현재 프레임 detections (keyframe 마커 표시용)
  onChange: (frame: number) => void
  tracks?: TrackInfo[]
  identities?: IdentityInfo[]
}

export default function Timeline({
  currentFrame,
  totalFrames,
  fps,
  detections,
  onChange,
  tracks = [],
  identities = [],
}: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [zoomLevel, setZoomLevel] = useState(1)

  const scrubberWidthPercent = Math.max(100, zoomLevel * 100)

  const clampFrame = useCallback(
    (frame: number): number => {
      if (totalFrames <= 0) return 0
      return Math.max(0, Math.min(totalFrames - 1, frame))
    },
    [totalFrames],
  )

  const frameToPercent = useCallback(
    (frame: number): number => {
      if (totalFrames <= 1) return 0
      return (clampFrame(frame) / (totalFrames - 1)) * 100
    },
    [clampFrame, totalFrames],
  )

  const getIdentityColor = useCallback((identityId: number | null): string => {
    if (identityId === null) return "#9CA3AF"
    const idx = Math.abs(identityId) % IDENTITY_PALETTE.length
    return IDENTITY_PALETTE[idx]
  }, [])

  const frameFromEvent = useCallback(
    (e: React.MouseEvent | MouseEvent): number | null => {
      const bar = barRef.current
      if (!bar || totalFrames === 0) return null
      const rect = bar.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      return clampFrame(Math.round(ratio * (totalFrames - 1)))
    },
    [clampFrame, totalFrames],
  )

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const f = frameFromEvent(e)
    if (f !== null) onChange(f)

    const onMove = (ev: MouseEvent) => {
      const f2 = frameFromEvent(ev)
      if (f2 !== null) onChange(f2)
    }
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (totalFrames <= 1) return
    e.preventDefault()
    const viewport = viewportRef.current
    if (!viewport) return

    const delta = e.deltaY < 0 ? 0.15 : -0.15
    const nextZoom = Math.max(0.5, Math.min(10, zoomLevel + delta))
    if (nextZoom === zoomLevel) return

    const oldWidth = viewport.clientWidth * Math.max(1, zoomLevel)
    const newWidth = viewport.clientWidth * Math.max(1, nextZoom)
    const viewportRect = viewport.getBoundingClientRect()
    const cursorX = Math.max(0, Math.min(viewport.clientWidth, e.clientX - viewportRect.left))
    const cursorRatio = oldWidth > 0 ? (viewport.scrollLeft + cursorX) / oldWidth : 0

    setZoomLevel(nextZoom)

    requestAnimationFrame(() => {
      const newScroll = cursorRatio * newWidth - cursorX
      const maxScroll = Math.max(0, newWidth - viewport.clientWidth)
      viewport.scrollLeft = Math.max(0, Math.min(maxScroll, newScroll))
    })
  }

  const pct = totalFrames > 1 ? (currentFrame / (totalFrames - 1)) * 100 : 0
  const keyframes = useMemo(() => {
    const seen = new Set<number>()
    return detections
      .filter((d) => d.is_keyframe)
      .sort((a, b) => a.frame_idx - b.frame_idx)
      .filter((d) => {
        if (seen.has(d.frame_idx)) return false
        seen.add(d.frame_idx)
        return true
      })
  }, [detections])

  const identityRows = useMemo(() => {
    const byIdentity = new Map<number | null, TrackInfo[]>()
    for (const track of tracks) {
      const key = track.identity_id
      const list = byIdentity.get(key)
      if (list) list.push(track)
      else byIdentity.set(key, [track])
    }

    const rows: Array<{
      identityId: number | null
      label: string
      color: string
      tracks: TrackInfo[]
    }> = []

    for (const [identityId, identityTracks] of byIdentity) {
      const identity = identityId === null ? null : identities.find((item) => item.id === identityId)
      const label =
        identityId === null
          ? "Unknown"
          : identity?.label?.trim() || `${identity?.class_name || "Identity"} #${identityId}`
      rows.push({
        identityId,
        label,
        color: getIdentityColor(identityId),
        tracks: identityTracks,
      })
    }

    rows.sort((a, b) => {
      if (a.identityId === null) return 1
      if (b.identityId === null) return -1
      return a.identityId - b.identityId
    })

    return rows
  }, [getIdentityColor, identities, tracks])

  const timecode = totalFrames > 0 && fps > 0
    ? `${String(Math.floor(currentFrame / fps / 60)).padStart(2, "0")}:${String(Math.floor((currentFrame / fps) % 60)).padStart(2, "0")}`
    : "00:00"

  return (
    <div className="px-4 py-0.5 select-none bg-card" onWheel={handleWheel}>
      <div ref={viewportRef} className="overflow-x-auto">
        <div style={{ width: `${scrubberWidthPercent}%`, minWidth: "100%" }}>
          <div
            ref={barRef}
            className="relative h-5 bg-muted rounded cursor-pointer hover:bg-muted/80 transition-colors"
            onMouseDown={handleMouseDown}
          >
            <div
              className="absolute top-0 left-0 h-full bg-primary/25 rounded-l pointer-events-none transition-none"
              style={{ width: `${pct}%` }}
            />
            {totalFrames > 0 &&
              keyframes.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] leading-none text-yellow-300 hover:text-yellow-200 cursor-pointer"
                  style={{ left: `${frameToPercent(d.frame_idx)}%` }}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    onChange(clampFrame(d.frame_idx))
                  }}
                  aria-label={`Jump to keyframe ${d.frame_idx}`}
                >
                  ◆
                </button>
              ))}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background shadow pointer-events-none"
              style={{ left: `${pct}%` }}
            />
          </div>

          <div className="mt-0.5 max-h-12 overflow-y-auto pr-1 space-y-px">
            {identityRows.length === 0 ? (
              <div className="text-xs text-muted-foreground">No identity tracks</div>
            ) : (
              identityRows.map((row) => (
                <div key={row.identityId ?? -1} className="flex items-center gap-1.5">
                  <div className="w-20 shrink-0 truncate text-[10px] text-muted-foreground" title={row.label}>
                    {row.label}
                  </div>
                  <div className="relative h-3 flex-1 bg-muted/60 rounded">
                    {row.tracks.map((track) => {
                      const start = frameToPercent(track.start_frame)
                      const end = frameToPercent(track.end_frame)
                      const width = Math.max(0.35, end - start)
                      return (
                        <div
                          key={track.id}
                          className="absolute top-0.5 h-2 rounded-sm"
                          style={{
                            left: `${start}%`,
                            width: `${width}%`,
                            backgroundColor: row.color,
                          }}
                          title={`Track ${track.id}: ${track.start_frame} - ${track.end_frame}`}
                        />
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center text-[10px] text-muted-foreground mt-0.5">
        <span className="font-mono">{timecode} | F{currentFrame}/{totalFrames > 0 ? totalFrames - 1 : 0}</span>
        <span>zoom {zoomLevel.toFixed(1)}x</span>
      </div>
    </div>
  )
}
