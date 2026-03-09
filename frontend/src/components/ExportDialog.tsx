/**
 * ExportDialog — YOLO / MOT 포맷 내보내기 다이얼로그
 */
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api/client"
import { useProjectStore } from "@/stores/projectStore"
import { ClipboardCopy } from "lucide-react"

interface ExportResponse {
  output_path: string
  frame_count: number
  detection_count: number
  track_count: number | null
}

interface ExportInfo {
  export_dir: string
}

interface Props {
  projectId: number
  onClose: () => void
}

type Format = "yolo" | "mot"

export default function ExportDialog({ projectId, onClose }: Props) {
  const { classes: projectClasses } = useProjectStore()

  const [format, setFormat] = useState<Format>("yolo")
  const [frameStart, setFrameStart] = useState(0)
  const [frameEnd, setFrameEnd] = useState("")
  const [confThreshold, setConfThreshold] = useState(0.0)
  const [minDetections, setMinDetections] = useState(1)
  const [valSplit, setValSplit] = useState(0.2)
  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ExportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createSnapshot, setCreateSnapshot] = useState(true)
  const [exportDir, setExportDir] = useState<string | null>(null)

  useEffect(() => {
    api.get<ExportInfo>(`/projects/${projectId}/export/info`)
      .then((info) => setExportDir(info.export_dir))
      .catch(() => setExportDir(null))
  }, [projectId])

  const toggleClass = (cls: string) => {
    setSelectedClasses((prev) =>
      prev.includes(cls) ? prev.filter((c) => c !== cls) : [...prev, cls],
    )
  }

  const handleExport = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      if (createSnapshot) {
        await api.post<{ path: string }>("/projects/snapshot", {})
        toast.success("DB 스냅샷 생성 완료")
      }
      const body = {
        frame_start: frameStart,
        frame_end: frameEnd !== "" ? Number(frameEnd) : null,
        conf_threshold: confThreshold,
        min_detections: minDetections,
        classes: selectedClasses.length > 0 ? selectedClasses : null,
        ...(format === "yolo" ? { val_split: valSplit } : {}),
      }
      const res = await api.post<ExportResponse>(
        `/projects/${projectId}/export/${format}`,
        body,
      )
      setResult(res)
      toast.success(`Export 완료: ${res.detection_count}개 detection, ${res.frame_count}개 프레임`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    /* backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-popover border border-border rounded-lg shadow-xl w-[420px] max-h-[90vh] overflow-auto text-sm">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold">데이터셋 내보내기</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {exportDir && (
            <div className="rounded border border-border bg-accent/20 px-3 py-2 text-xs text-muted-foreground">
              저장 위치: <span className="font-mono text-foreground break-all">{exportDir}</span>
            </div>
          )}

          {/* format selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Format</label>
            <div className="flex gap-2">
              {(["yolo", "mot"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex-1 py-2 rounded border text-xs font-medium transition-colors ${
                    format === f
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-muted-foreground"
                  }`}
                >
                  {f === "yolo" ? "YOLO Detection" : "MOT Challenge"}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {format === "yolo"
                ? "labels/train · labels/val · data.yaml"
                : "gt/gt.txt · seqinfo.ini (per video)"}
            </p>
          </div>

          {/* classes filter */}
          {projectClasses.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                포함 클래스 <span className="text-[10px] font-normal normal-case">(미선택 시 전체)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {projectClasses.map((cls) => {
                  const checked = selectedClasses.includes(cls)
                  return (
                    <label key={cls} className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleClass(cls)}
                        className="accent-primary"
                      />
                      <span className={checked ? "text-foreground" : "text-muted-foreground"}>{cls}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* frame range */}
          <div className="flex gap-3">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Frame Start</label>
              <input
                type="number"
                value={frameStart}
                min={0}
                onChange={(e) => setFrameStart(Math.max(0, Number(e.target.value)))}
                className="bg-background border border-border rounded px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Frame End <span className="text-[10px]">(비워두면 전체)</span></label>
              <input
                type="number"
                value={frameEnd}
                placeholder="전체"
                min={0}
                onChange={(e) => setFrameEnd(e.target.value)}
                className="bg-background border border-border rounded px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* conf threshold + min detections */}
          <div className="flex gap-3">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Conf Threshold</label>
              <input
                type="number"
                value={confThreshold}
                min={0} max={1} step={0.05}
                onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
                className="bg-background border border-border rounded px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Min Detections/Track</label>
              <input
                type="number"
                value={minDetections}
                min={1}
                onChange={(e) => setMinDetections(Math.max(1, Number(e.target.value)))}
                className="bg-background border border-border rounded px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* val split (YOLO only) */}
          {format === "yolo" && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Validation Split ({Math.round(valSplit * 100)}%)</label>
              <input
                type="range"
                value={valSplit}
                min={0} max={0.5} step={0.05}
                onChange={(e) => setValSplit(parseFloat(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
          )}

          {/* snapshot option */}
          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={createSnapshot}
              onChange={(e) => setCreateSnapshot(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-muted-foreground">내보내기 전 DB 스냅샷 생성</span>
          </label>

          {/* result */}
          {result && (
            <div className="rounded border border-green-500/30 bg-green-500/10 px-3 py-2.5 flex flex-col gap-1.5 text-xs">
              <p className="font-medium text-green-400">✓ Export 완료</p>
              <div className="flex items-center gap-1.5">
                <p className="flex-1 text-foreground font-mono text-[10px] break-all bg-background/50 rounded px-2 py-1 border border-border">
                  {result.output_path}
                </p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(result.output_path)
                    toast.success("경로가 클립보드에 복사됨")
                  }}
                  className="flex-shrink-0 px-2 py-1 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  title="경로 복사"
                >
                  <ClipboardCopy className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex gap-3 text-muted-foreground mt-0.5">
                <span>{result.frame_count} frames</span>
                <span>{result.detection_count} detections</span>
                {result.track_count !== null && <span>{result.track_count} tracks</span>}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded border border-border text-xs hover:bg-accent transition-colors"
          >
            닫기
          </button>
          <button
            onClick={handleExport}
            disabled={loading}
            className="px-4 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? "내보내는 중…" : `${format === "yolo" ? "YOLO" : "MOT"} 내보내기 시작`}
          </button>
        </div>
      </div>
    </div>
  )
}
