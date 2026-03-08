/**
 * CropGrid — identity 하나에 속한 detection crop 썸네일을 N열 그리드로 표시.
 *
 * 각 crop은 `/api/v1/videos/{video_id}/frame/{frame_idx}` 에서 전체 프레임을 받아
 * <canvas>에 bbox 영역만 잘라 렌더링합니다.
 */
import { useEffect, useRef, useState } from "react"

interface CropItem {
  detection_id: number
  video_id: number
  frame_idx: number
  track_id: number | null
  bbox: { x: number; y: number; w: number; h: number }
  anomaly_score?: number | null
}

const ANOMALY_THRESHOLD = 0.5

interface CropCellProps {
  item: CropItem
  selected: boolean
  onClick: () => void
}

const API_BASE = "/api/v1"

function CropCell({ item, selected, onClick }: CropCellProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hoveredItem, setHoveredItem] = useState<CropItem | null>(null)
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const isAnomaly = item.anomaly_score != null && item.anomaly_score > ANOMALY_THRESHOLD

  useEffect(() => {
    setLoaded(false)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = "anonymous"
    img.src = `${API_BASE}/videos/${item.video_id}/frame/${item.frame_idx}`
    img.onload = () => {
      const { x, y, w, h } = item.bbox
      // 내부 해상도를 bbox 크기로 설정
      canvas.width = Math.max(1, Math.round(w))
      canvas.height = Math.max(1, Math.round(h))
      ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height)
      setLoaded(true)
    }
    img.onerror = () => {
      // 에러 시 fallback 표시
      canvas.width = 80
      canvas.height = 80
      ctx.fillStyle = "#333"
      ctx.fillRect(0, 0, 80, 80)
      ctx.fillStyle = "#888"
      ctx.font = "10px sans-serif"
      ctx.textAlign = "center"
      ctx.fillText("No frame", 40, 44)
    }
  }, [item])

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    setHoveredItem(item)
    setHoverPos({ x: e.clientX, y: e.clientY })
  }

  const handleMouseLeave = () => {
    setHoveredItem(null)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (hoveredItem) {
      setHoverPos({ x: e.clientX, y: e.clientY })
    }
  }

  return (
    <div
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      className={`relative cursor-pointer rounded overflow-hidden border-2 transition-all aspect-square ${
        isAnomaly
          ? "border-red-500 ring-1 ring-red-500/50"
          : selected
            ? "border-primary ring-1 ring-primary"
            : "border-border hover:border-muted-foreground"
      }`}
      title={`Det #${item.detection_id} · f${item.frame_idx} · Track #${item.track_id ?? "—"}${
        item.anomaly_score != null ? ` · anomaly: ${(item.anomaly_score * 100).toFixed(0)}%` : ""
      }`}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain block"
        style={{ imageRendering: "auto" }}
      />
      {isAnomaly && (
        <div className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-red-500/80 text-white text-[9px] leading-none">
          ⚠
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/60 text-[9px] text-white/80 tabular-nums truncate">
        f{item.frame_idx}
      </div>
      {hoveredItem && (
        <PreviewTooltip item={hoveredItem} x={hoverPos.x} y={hoverPos.y} />
      )}
    </div>
  )
}

interface PreviewTooltipProps {
  item: CropItem
  x: number
  y: number
}

function PreviewTooltip({ item, x, y }: PreviewTooltipProps) {
  const PREVIEW_WIDTH = 320
  const PREVIEW_HEIGHT = 400
  const OFFSET = 12
  const VIEWPORT_PADDING = 8

  // Calculate position with viewport clamping
  let posX = x + OFFSET
  let posY = y + OFFSET

  // Clamp to viewport
  if (posX + PREVIEW_WIDTH + VIEWPORT_PADDING > window.innerWidth) {
    posX = window.innerWidth - PREVIEW_WIDTH - VIEWPORT_PADDING
  }
  if (posX < VIEWPORT_PADDING) {
    posX = VIEWPORT_PADDING
  }
  if (posY + PREVIEW_HEIGHT + VIEWPORT_PADDING > window.innerHeight) {
    posY = window.innerHeight - PREVIEW_HEIGHT - VIEWPORT_PADDING
  }
  if (posY < VIEWPORT_PADDING) {
    posY = VIEWPORT_PADDING
  }

  return (
    <div
      className="fixed pointer-events-none z-50 rounded border border-border bg-black/90 shadow-lg overflow-hidden"
      style={{
        left: `${posX}px`,
        top: `${posY}px`,
        width: `${PREVIEW_WIDTH}px`,
        height: `${PREVIEW_HEIGHT}px`,
      }}
    >
      <img
        src={`${API_BASE}/videos/${item.video_id}/frame/${item.frame_idx}`}
        alt="Preview"
        className="w-full h-full object-contain"
      />
    </div>
  )
}

interface Props {
  items: CropItem[]
  selectedDetectionId: number | null
  onSelect: (detectionId: number) => void
  cols?: number
}

export default function CropGrid({ items, selectedDetectionId, onSelect, cols = 4 }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        이 Identity에 속한 detection이 없습니다.
      </div>
    )
  }

  return (
    <div
      className="grid gap-1 p-2"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <CropCell
          key={item.detection_id}
          item={item}
          selected={item.detection_id === selectedDetectionId}
          onClick={() => onSelect(item.detection_id)}
        />
      ))}
    </div>
  )
}
