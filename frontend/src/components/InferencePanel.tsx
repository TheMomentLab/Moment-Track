/**
 * InferencePanel — 슬라이드 인 패널. YOLO Detection / ByteTrack / ReID 임베딩 잡 제출 + 상태 모니터링.
 */
import { useState, useEffect, useCallback, useRef } from "react"
import { api } from "@/api/client"

interface JobRead {
  id: number
  job_type: string
  status: string
  progress: number
  error_msg: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

interface Props {
  projectId: number
  videoId: number
  onClose: () => void
}

type Tab = "detect" | "track" | "embed"

const STATUS_COLOR: Record<string, string> = {
  pending: "text-yellow-400",
  running: "text-blue-400",
  done: "text-green-400",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
}

export default function InferencePanel({ projectId, videoId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("detect")
  const [jobs, setJobs] = useState<JobRead[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // progress tracking per job: { jobId -> [{ t: timestamp, p: progress }] }
  const progressHistory = useRef<Record<number, Array<{ t: number; p: number }>>>({})

  // detect params
  const [modelPath, setModelPath] = useState("")
  const [confThreshold, setConfThreshold] = useState(0.5)
  const [iouThreshold, setIouThreshold] = useState(0.45)
  const [frameStart, setFrameStart] = useState(0)
  const [frameEnd, setFrameEnd] = useState("")

  // track params
  const [trackThresh, setTrackThresh] = useState(0.5)
  const [matchThresh, setMatchThresh] = useState(0.8)
  const [trackBuffer, setTrackBuffer] = useState(30)

  // embed params
  const [embedModelPath, setEmbedModelPath] = useState("")
  const [batchSize, setBatchSize] = useState(64)

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<JobRead[]>(`/projects/${projectId}/inference/jobs`)
      const now = Date.now()
      res.forEach((job) => {
        if (job.status === "running") {
          const hist = progressHistory.current[job.id] ?? []
          hist.push({ t: now, p: job.progress })
          // keep last 10 samples
          if (hist.length > 10) hist.splice(0, hist.length - 10)
          progressHistory.current[job.id] = hist
        }
      })
      setJobs(res)
    } catch {}
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { loadJobs() }, [loadJobs])

  // poll running jobs every 2s
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === "pending" || j.status === "running")
    if (!hasActive) return
    const id = setInterval(loadJobs, 2000)
    return () => clearInterval(id)
  }, [jobs, loadJobs])

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      let body: Record<string, unknown>
      let endpoint: string

      if (tab === "detect") {
        endpoint = "/inference/detect"
        body = {
          video_id: videoId,
          model_path: modelPath,
          frame_start: frameStart,
          frame_end: frameEnd !== "" ? Number(frameEnd) : null,
          conf_threshold: confThreshold,
          iou_threshold: iouThreshold,
        }
      } else if (tab === "track") {
        endpoint = "/inference/track"
        body = {
          video_id: videoId,
          frame_start: frameStart,
          frame_end: frameEnd !== "" ? Number(frameEnd) : null,
          track_thresh: trackThresh,
          match_thresh: matchThresh,
          track_buffer: trackBuffer,
        }
      } else {
        endpoint = "/inference/embed"
        body = {
          video_id: videoId,
          model_path: embedModelPath,
          batch_size: batchSize,
        }
      }

      await api.post<{ job_id: number; status: string }>(endpoint, body)
      await loadJobs()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed")
    } finally {
      setSubmitting(false)
    }
  }

  const cancelJob = async (jobId: number) => {
    try {
      await api.delete(`/inference/jobs/${jobId}`)
      await loadJobs()
    } catch {}
  }

  return (
    /* slide-in panel — fixed right side */
    <div className="fixed inset-y-0 right-0 z-40 flex">
      {/* backdrop */}
      <div className="absolute inset-0 -left-full bg-black/40" onClick={onClose} />

      <div className="relative w-80 flex flex-col bg-card border-l border-border shadow-2xl text-sm">
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h2 className="font-semibold text-sm">AI Inference</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {/* workflow guide */}
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border text-[10px] text-muted-foreground">
          <span className={tab === "detect" ? "text-primary font-medium" : ""}>① Detect</span>
          <span>→</span>
          <span className={tab === "track" ? "text-primary font-medium" : ""}>② Track</span>
          <span>→</span>
          <span className={tab === "embed" ? "text-primary font-medium" : ""}>③ ReID</span>
        </div>

        {/* tabs */}
        <div className="flex border-b border-border flex-shrink-0 text-xs">
          {(["detect", "track", "embed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 capitalize transition-colors ${
                tab === t
                  ? "border-b-2 border-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "detect" ? "Detect" : t === "track" ? "Track" : "ReID"}
            </button>
          ))}
        </div>

        {/* form */}
        <div className="flex-1 overflow-auto px-4 py-3 flex flex-col gap-3">
          {/* shared: frame range */}
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Frame Start</label>
              <input
                type="number" value={frameStart} min={0}
                onChange={(e) => setFrameStart(Math.max(0, Number(e.target.value)))}
                className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary"
              />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Frame End</label>
              <input
                type="number" value={frameEnd} placeholder="전체"
                onChange={(e) => setFrameEnd(e.target.value)}
                className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* detect params */}
          {tab === "detect" && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Model Path</label>
                <input
                  type="text" value={modelPath} placeholder="/path/to/yolo.pt"
                  onChange={(e) => setModelPath(e.target.value)}
                  className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Conf</label>
                  <input type="number" value={confThreshold} min={0} max={1} step={0.05}
                    onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
                    className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary" />
                </div>
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">IoU</label>
                  <input type="number" value={iouThreshold} min={0} max={1} step={0.05}
                    onChange={(e) => setIouThreshold(parseFloat(e.target.value))}
                    className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary" />
                </div>
              </div>
            </>
          )}

          {/* track params */}
          {tab === "track" && (
            <>
              <div className="flex gap-2">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Track Thresh</label>
                  <input type="number" value={trackThresh} min={0} max={1} step={0.05}
                    onChange={(e) => setTrackThresh(parseFloat(e.target.value))}
                    className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary" />
                </div>
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Match Thresh</label>
                  <input type="number" value={matchThresh} min={0} max={1} step={0.05}
                    onChange={(e) => setMatchThresh(parseFloat(e.target.value))}
                    className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Track Buffer (frames)</label>
                <input type="number" value={trackBuffer} min={1}
                  onChange={(e) => setTrackBuffer(Math.max(1, Number(e.target.value)))}
                  className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary" />
              </div>
            </>
          )}

          {/* embed params */}
          {tab === "embed" && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Model Path</label>
                <input type="text" value={embedModelPath} placeholder="/path/to/reid.pt"
                  onChange={(e) => setEmbedModelPath(e.target.value)}
                  className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Batch Size</label>
                <input type="number" value={batchSize} min={1}
                  onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value)))}
                  className="bg-background border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary" />
              </div>
            </>
          )}

          <div className="text-[10px] text-muted-foreground bg-accent/30 rounded px-2 py-1.5 leading-relaxed">
            Workers가 없으면 잡은 <span className="text-yellow-400">pending</span> 상태로 저장됩니다.
            별도 GPU worker 프로세스를 실행하면 자동으로 처리됩니다.
          </div>

          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-2 py-1.5">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-2 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "제출 중…" : "Submit Job"}
          </button>
        </div>

        {/* job history */}
        <div className="border-t border-border flex-shrink-0">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Recent Jobs
            </span>
            <button onClick={loadJobs} className="text-[10px] text-muted-foreground hover:text-foreground">
              ↻
            </button>
          </div>
          <div className="max-h-48 overflow-auto">
            {loading && jobs.length === 0 && (
              <p className="text-xs text-muted-foreground px-4 py-2">로딩 중…</p>
            )}
            {!loading && jobs.length === 0 && (
              <p className="text-xs text-muted-foreground px-4 py-2">잡 없음</p>
            )}
            {jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center gap-2 px-4 py-1.5 hover:bg-accent/40 text-xs"
              >
                <span className="w-14 truncate text-muted-foreground capitalize">{job.job_type}</span>
                <span className={`flex-1 font-medium ${STATUS_COLOR[job.status] ?? ""}`}>
                  {job.status}
                </span>
                {job.status === "running" && (() => {
                  const hist = progressHistory.current[job.id] ?? []
                  let etaStr = ""
                  if (hist.length >= 2) {
                    const oldest = hist[0]
                    const newest = hist[hist.length - 1]
                    const dProgress = newest.p - oldest.p
                    const dTime = (newest.t - oldest.t) / 1000 // seconds
                    if (dProgress > 0 && dTime > 0) {
                      const remaining = (1 - newest.p) / (dProgress / dTime)
                      if (remaining < 60) etaStr = `~${Math.round(remaining)}s`
                      else etaStr = `~${Math.round(remaining / 60)}m`
                    }
                  }
                  return (
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {Math.round(job.progress * 100)}%{etaStr ? ` · ${etaStr}` : ""}
                    </span>
                  )
                })()}
                {(job.status === "pending" || job.status === "running") && (
                  <button
                    onClick={() => cancelJob(job.id)}
                    className="text-[10px] text-muted-foreground hover:text-destructive"
                    title="취소"
                  >
                    ✕
                  </button>
                )}
                <span className="text-[10px] text-muted-foreground">#{job.id}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
