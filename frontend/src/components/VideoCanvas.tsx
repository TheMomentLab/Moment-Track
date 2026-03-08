/**
 * VideoCanvas — react-konva 기반 프레임 렌더링 + BBox 오버레이 + 어노테이션 인터랙션
 */
import { useEffect, useRef, useState } from "react"
import { Stage, Layer, Image as KonvaImage, Rect, Group, Text } from "react-konva"
import type Konva from "konva"
import type { Detection, Track, Tool } from "@/types"

const MIN_ZOOM = 0.2
const MAX_ZOOM = 5
const WHEEL_ZOOM_FACTOR = 1.05

const IDENTITY_PALETTE = [
  "#FF6B6B", "#4ECDC4", "#FFE66D", "#6C5CE7",
  "#A29BFE", "#FD79A8", "#00B894", "#E17055",
]

function trackColor(trackId: number | null): string {
  if (trackId === null) return "#94a3b8"
  return IDENTITY_PALETTE[Math.abs(trackId) % IDENTITY_PALETTE.length]
}

interface DrawingRect {
  x: number; y: number; w: number; h: number
}

interface Props {
  videoId: number
  frameIdx: number
  detections: Detection[]
  videoWidth: number   // 원본 영상 너비
  videoHeight: number  // 원본 영상 높이
  tool: Tool
  selectedDetectionId: number | null
  defaultClass: string
  onSelect: (id: number | null) => void
  onCreate: (det: { frame_idx: number; x: number; y: number; w: number; h: number; class_name: string }) => void
  onUpdate: (id: number, bbox: { x: number; y: number; w: number; h: number }) => void
  onDelete: (id: number) => void
  classes?: string[]
  onKeyframeToggle?: (id: number) => void
  onDeleteAllOnFrame?: (frameIdx: number) => void
  onClassChange?: (id: number, className: string) => void
  tracks?: Track[]
}

export default function VideoCanvas({
  videoId, frameIdx, detections, videoWidth, videoHeight,
  tool, selectedDetectionId, defaultClass, onSelect, onCreate, onUpdate,
  onDelete,
  classes = [],
  onKeyframeToggle = () => {},
  onDeleteAllOnFrame = () => {},
  onClassChange = () => {},
  tracks = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [frameImage, setFrameImage] = useState<HTMLImageElement | null>(null)
  const [drawing, setDrawing] = useState<DrawingRect | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; detectionId: number } | null>(null)
  const [zoomScale, setZoomScale] = useState(1)
  const [stageOffset, setStageOffset] = useState({ x: 0, y: 0 })
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const drawStart = useRef<{ x: number; y: number } | null>(null)
  const panStartPointer = useRef<{ x: number; y: number } | null>(null)
  const panStartOffset = useRef<{ x: number; y: number } | null>(null)
  const lastPointer = useRef<{ x: number; y: number } | null>(null)

  // 컨테이너 크기 감지
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setContainerSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    setContainerSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // 프레임 이미지 로드
  useEffect(() => {
    if (!videoId) return
    setFrameImage(null)
    const img = new window.Image()
    img.onload = () => setFrameImage(img)
    img.onerror = () => setFrameImage(null)
    img.src = `/api/v1/videos/${videoId}/frame/${frameIdx}`
    return () => { img.src = "" }
  }, [videoId, frameIdx])

  // 스케일 계산 (비율 유지, 중앙 정렬)
  const fitScale =
    videoWidth > 0 && videoHeight > 0 && containerSize.width > 0 && containerSize.height > 0
      ? Math.min(containerSize.width / videoWidth, containerSize.height / videoHeight)
      : 1
  const canvasW = videoWidth * fitScale
  const canvasH = videoHeight * fitScale
  const offsetX = (containerSize.width - canvasW) / 2
  const offsetY = (containerSize.height - canvasH) / 2

  const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))

  const updateZoomAtPoint = (
    point: { x: number; y: number },
    getNextZoom: (prevZoom: number) => number,
  ) => {
    setZoomScale((prevZoom) => {
      const nextZoom = clampZoom(getNextZoom(prevZoom))
      if (nextZoom === prevZoom) return prevZoom
      setStageOffset((prevOffset) => ({
        x: point.x - ((point.x - prevOffset.x) / prevZoom) * nextZoom,
        y: point.y - ((point.y - prevOffset.y) / prevZoom) * nextZoom,
      }))
      return nextZoom
    })
  }

  // 스테이지 좌표 → 영상 좌표 변환
  const toVideo = (sx: number, sy: number) => {
    const sceneX = (sx - stageOffset.x) / zoomScale
    const sceneY = (sy - stageOffset.y) / zoomScale
    return {
      x: (sceneX - offsetX) / fitScale,
      y: (sceneY - offsetY) / fitScale,
    }
  }

  // 스테이지 마우스 핸들러
  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition()
    if (pos) {
      lastPointer.current = pos
    }

    const isMiddleClick = e.evt.button === 1
    const isSpacePan = isSpacePressed && e.evt.button === 0
    if (isMiddleClick || isSpacePan) {
      e.evt.preventDefault()
      setContextMenu(null)
      if (!pos) return
      setIsPanning(true)
      panStartPointer.current = pos
      panStartOffset.current = { ...stageOffset }
      drawStart.current = null
      setDrawing(null)
      return
    }

    if (tool !== "box") return
    if (!pos) return
    const v = toVideo(pos.x, pos.y)
    drawStart.current = v
    setDrawing({ x: v.x, y: v.y, w: 0, h: 0 })
  }

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition()
    if (pos) {
      lastPointer.current = pos
    }

    if (isPanning && panStartPointer.current && panStartOffset.current && pos) {
      setStageOffset({
        x: panStartOffset.current.x + (pos.x - panStartPointer.current.x),
        y: panStartOffset.current.y + (pos.y - panStartPointer.current.y),
      })
      return
    }

    if (tool !== "box" || !drawStart.current) return
    if (!pos) return
    const v = toVideo(pos.x, pos.y)
    const sx = drawStart.current.x
    const sy = drawStart.current.y
    setDrawing({
      x: Math.min(v.x, sx),
      y: Math.min(v.y, sy),
      w: Math.abs(v.x - sx),
      h: Math.abs(v.y - sy),
    })
  }

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false)
      panStartPointer.current = null
      panStartOffset.current = null
      return
    }

    if (tool !== "box" || !drawStart.current || !drawing) return
    drawStart.current = null
    if (drawing.w > 5 && drawing.h > 5) {
      onCreate({ frame_idx: frameIdx, ...drawing, class_name: defaultClass })
    }
    setDrawing(null)
  }

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    setContextMenu(null)
    if (tool !== "select") return
    const target = e.target
    // 배경(Stage 또는 Image) 클릭 → 선택 해제
    if (target === target.getStage() || target.getClassName() === "Image") {
      onSelect(null)
    }
  }

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    if (!e.evt.ctrlKey) return
    e.evt.preventDefault()
    const pointer = e.target.getStage()?.getPointerPosition()
    if (!pointer) return
    lastPointer.current = pointer
    updateZoomAtPoint(pointer, (prevZoom) =>
      e.evt.deltaY < 0 ? prevZoom * WHEEL_ZOOM_FACTOR : prevZoom / WHEEL_ZOOM_FACTOR,
    )
  }

  const handleContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " ") {
      e.preventDefault()
      setIsSpacePressed(true)
      return
    }

    if (!e.ctrlKey) return

    const pivotPoint = lastPointer.current ?? {
      x: containerSize.width / 2,
      y: containerSize.height / 2,
    }

    if (e.key === "=" || e.key === "+") {
      e.preventDefault()
      e.stopPropagation()
      updateZoomAtPoint(pivotPoint, (prevZoom) => prevZoom + 0.1)
      return
    }

    if (e.key === "-") {
      e.preventDefault()
      e.stopPropagation()
      updateZoomAtPoint(pivotPoint, (prevZoom) => prevZoom - 0.1)
      return
    }

    if (e.key === "0") {
      e.preventDefault()
      e.stopPropagation()
      setZoomScale(1)
      setStageOffset({ x: 0, y: 0 })
    }
  }

  const handleContainerKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " ") {
      setIsSpacePressed(false)
    }
  }

  const handleContainerBlur = () => {
    setIsSpacePressed(false)
    setIsPanning(false)
    panStartPointer.current = null
    panStartOffset.current = null
  }

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (!contextMenuRef.current?.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null)
      }
    }
    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  const contextDetection = contextMenu
    ? detections.find((det) => det.id === contextMenu.detectionId) ?? null
    : null

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-black outline-none"
      tabIndex={0}
      onPointerDown={() => containerRef.current?.focus()}
      onKeyDown={handleContainerKeyDown}
      onKeyUp={handleContainerKeyUp}
      onBlur={handleContainerBlur}
    >
      {containerSize.width > 0 && (
        <Stage
          width={containerSize.width}
          height={containerSize.height}
          x={stageOffset.x}
          y={stageOffset.y}
          scaleX={zoomScale}
          scaleY={zoomScale}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleStageClick}
          onWheel={handleWheel}
          style={{
            cursor: isPanning
              ? "grabbing"
              : isSpacePressed
                ? "grab"
                : tool === "box"
                  ? "crosshair"
                  : "default",
          }}
        >
          {/* 프레임 이미지 레이어 */}
          <Layer>
            {frameImage ? (
              <KonvaImage
                image={frameImage}
                x={offsetX}
                y={offsetY}
                width={canvasW}
                height={canvasH}
              />
            ) : (
              <Rect
                x={offsetX}
                y={offsetY}
                width={canvasW || containerSize.width}
                height={canvasH || containerSize.height}
                fill="#111"
              />
            )}
          </Layer>

          {/* BBox 레이어 */}
          <Layer>
            {detections.map((det) => {
              const color = trackColor(det.track_id)
              const isSelected = det.id === selectedDetectionId
              const rx = offsetX + det.x * fitScale
              const ry = offsetY + det.y * fitScale
              const rw = det.w * fitScale
              const rh = det.h * fitScale
              const identityId = det.track_id != null ? tracks.find(t => t.id === det.track_id)?.identity_id : null
              const labelText = `${det.class_name}${identityId != null ? ` | ID#${identityId}` : det.track_id != null ? ` | T${det.track_id}` : ""}`
              const labelFontSize = Math.max(8, 10 * fitScale)
              const labelPaddingX = 3
              const labelPaddingY = 2
              const labelWidth = Math.max(28, labelText.length * labelFontSize * 0.56 + labelPaddingX * 2)
              const labelHeight = labelFontSize + labelPaddingY * 2
              const labelY = Math.max(offsetY, ry - labelHeight - 2)
              return (
                <Group key={det.id}>
                  <Group listening={false}>
                    <Rect
                      x={rx}
                      y={labelY}
                      width={labelWidth}
                      height={labelHeight}
                      fill="rgba(0,0,0,0.7)"
                      cornerRadius={2}
                    />
                    <Text
                      x={rx + labelPaddingX}
                      y={labelY + labelPaddingY}
                      text={labelText}
                      fontSize={labelFontSize}
                      fill="#ffffff"
                    />
                  </Group>

                  <Rect
                    x={rx}
                    y={ry}
                    width={rw}
                    height={rh}
                    stroke={isSelected ? "#ffffff" : color}
                    strokeWidth={det.is_keyframe ? 3 : (isSelected ? 2.5 : 1.5)}
                    dash={det.is_interpolated ? [6, 3] : undefined}
                    fill={isSelected ? "rgba(255,255,255,0.1)" : color + "26"}
                    draggable={tool === "select"}
                    onClick={(e) => {
                      e.cancelBubble = true
                      setContextMenu(null)
                      if (tool === "select") onSelect(det.id)
                    }}
                    onContextMenu={(e) => {
                      e.evt.preventDefault()
                      e.cancelBubble = true
                      const containerRect = containerRef.current?.getBoundingClientRect()
                      if (!containerRect) return
                      setContextMenu({
                        x: e.evt.clientX - containerRect.left,
                        y: e.evt.clientY - containerRect.top,
                        detectionId: det.id,
                      })
                    }}
                    onDragEnd={(e) => {
                      const newX = (e.target.x() - offsetX) / fitScale
                      const newY = (e.target.y() - offsetY) / fitScale
                      onUpdate(det.id, { x: newX, y: newY, w: det.w, h: det.h })
                      // Konva 위치 초기화 (상태로 관리)
                      e.target.x(rx)
                      e.target.y(ry)
                    }}
                  />
                </Group>
              )
            })}

            {/* 그리기 미리보기 */}
            {drawing && drawing.w > 1 && (
              <Rect
                x={offsetX + drawing.x * fitScale}
                y={offsetY + drawing.y * fitScale}
                width={drawing.w * fitScale}
                height={drawing.h * fitScale}
                stroke="#60a5fa"
                strokeWidth={1.5}
                dash={[5, 3]}
                fill="rgba(96,165,250,0.12)"
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      )}

      {contextMenu && contextDetection && (
        <div
          ref={contextMenuRef}
          className="absolute z-20 min-w-48 rounded border border-slate-700 bg-slate-900 py-1 text-xs text-slate-100 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {classes.map((className) => (
            <button
              key={className}
              type="button"
              className="block w-full px-3 py-1.5 text-left hover:bg-slate-700"
              onClick={() => {
                onClassChange(contextDetection.id, className)
                setContextMenu(null)
              }}
            >
              Class: {className}
            </button>
          ))}

          <div className="my-1 border-t border-slate-700" />

          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left hover:bg-slate-700"
            onClick={() => {
              onKeyframeToggle(contextDetection.id)
              setContextMenu(null)
            }}
          >
            Toggle Keyframe (K)
          </button>

          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left hover:bg-slate-700"
            onClick={() => {
              onDelete(contextDetection.id)
              setContextMenu(null)
            }}
          >
            Delete Detection (Del)
          </button>

          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left hover:bg-slate-700"
            onClick={() => {
              onDeleteAllOnFrame(frameIdx)
              setContextMenu(null)
            }}
          >
            Delete All on Frame
          </button>
        </div>
      )}
    </div>
  )
}
