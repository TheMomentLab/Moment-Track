import { useState, useEffect, useRef, useCallback } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { api } from "@/api/client"
import { useVideoStore } from "@/stores/videoStore"
import { toast } from "sonner"
import { useAnnotationStore } from "@/stores/annotationStore"
import { useProjectStore } from "@/stores/projectStore"
import { useUndoStore } from "@/stores/undoStore"
import VideoCanvas from "@/components/VideoCanvas"
import TrackList from "@/components/TrackList"
import Timeline from "@/components/Timeline"
import Logo from "@/components/Logo"
import type { Detection, VideoMeta, Tool, Track, Identity } from "@/types"
import InferencePanel from "@/components/InferencePanel"
import ExportDialog from "@/components/ExportDialog"

export default function VideoAnnotator() {
  const navigate = useNavigate()
  const { projectId, videoId } = useParams<{ projectId: string; videoId: string }>()
  const [searchParams] = useSearchParams()
  const pid = Number(projectId)
  const vid = Number(videoId)

  // ========== Stores ==========
  const { currentFrame, totalFrames, fps, isPlaying, playbackRate, setFrame, setVideoMeta, setPlaying, setPlaybackRate } =
    useVideoStore()
  const { selectedTrackId, selectedIdentityId, selectTrack, selectIdentity } =
    useAnnotationStore()
  const { classes, setProject, projectName } = useProjectStore()
  const { push: pushUndo, undo, redo } = useUndoStore()

  // ========== Local state ==========
  const [tool, setTool] = useState<Tool>("select")
  const [detections, setDetections] = useState<Detection[]>([])
  const [videoMeta, setVideoMetaLocal] = useState<VideoMeta | null>(null)
  const [selectedDetectionId, setSelectedDetectionId] = useState<number | null>(null)
  const [sideTab, setSideTab] = useState<"identities" | "tracks">("identities")
  const [sideRefreshKey, setSideRefreshKey] = useState(0) // TrackList리프레시 트리거
  const [showExport, setShowExport] = useState(false)
  const [showInference, setShowInference] = useState(false)
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Interpolation inline UI state
  const [interpFrameStart, setInterpFrameStart] = useState("")
  const [interpFrameEnd, setInterpFrameEnd] = useState("")
  const [interpRunning, setInterpRunning] = useState(false)

  // Timeline 용 tracks/identities
  const [tracks, setTracks] = useState<Track[]>([])
  const [identities, setIdentities] = useState<Identity[]>([])

  // ========== Refs (스테일 클로저 방지) ==========
  const currentFrameRef = useRef(currentFrame)
  const totalFramesRef = useRef(totalFrames)
  const isPlayingRef = useRef(isPlaying)
  const selectedDetectionIdRef = useRef(selectedDetectionId)
  const selectedTrackIdRef = useRef(selectedTrackId)
  const tracksRef = useRef(tracks)
  currentFrameRef.current = currentFrame
  totalFramesRef.current = totalFrames
  isPlayingRef.current = isPlaying
  selectedDetectionIdRef.current = selectedDetectionId
  selectedTrackIdRef.current = selectedTrackId
  tracksRef.current = tracks

  // ========== 데이터 로드 ==========
  // 프로젝트 + 비디오 메타 로드
  useEffect(() => {
    api
      .get<{ id: number; name: string; classes: string[] }>(`/projects/${pid}`)
      .then((p) => setProject(p.id, p.name, p.classes))
      .catch(() => {})

    api
      .get<VideoMeta>(`/videos/${vid}/meta`)
      .then((meta) => {
        setVideoMetaLocal(meta)
        setVideoMeta(meta.total_frames, meta.fps)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, vid])

  // URL ?frame=N 초기 프레임 설정
  useEffect(() => {
    const frameParam = searchParams.get("frame")
    if (frameParam) {
      const n = Number(frameParam)
      if (!isNaN(n) && n >= 0) setFrame(n)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 현재 프레임 Detection 로드
  const loadDetections = useCallback(() => {
    api
      .get<{ items: Detection[] }>(
        `/videos/${vid}/detections?frame_start=${currentFrameRef.current}&frame_end=${currentFrameRef.current}&limit=200`,
      )
      .then((r) => setDetections(r.items))
      .catch(() => setDetections([]))
  }, [vid])

  useEffect(() => {
    loadDetections()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vid, currentFrame])

  // Timeline 용 tracks/identities 로드
  const loadTracksAndIdentities = useCallback(() => {
    api
      .get<{ items: Track[] }>(`/projects/${pid}/tracks?video_id=${vid}&limit=1000`)
      .then((r) => setTracks(r.items))
      .catch(() => setTracks([]))
    api
      .get<{ items: Identity[] }>(`/projects/${pid}/identities?limit=200`)
      .then((r) => setIdentities(r.items))
      .catch(() => setIdentities([]))
  }, [pid, vid])

  useEffect(() => {
    loadTracksAndIdentities()
  }, [loadTracksAndIdentities, sideRefreshKey])

  // ========== 플레이백 ==========
  useEffect(() => {
    if (!isPlaying || totalFrames === 0) return
    const ms = Math.round(1000 / (Math.max(fps, 1) * playbackRate))
    const id = setInterval(() => {
      const next = currentFrameRef.current + 1
      if (next >= totalFramesRef.current) {
        setPlaying(false)
      } else {
        setFrame(next)
      }
    }, ms)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, fps, totalFrames, playbackRate])

  // ========== 메뉴 드롭다운 외부 클릭 닫기 ==========
  useEffect(() => {
    if (!menuOpen) return
    const handler = () => setMenuOpen(false)
    window.addEventListener("click", handler)
    return () => window.removeEventListener("click", handler)
  }, [menuOpen])

  // ========== 키보드 단축키 ==========
  const handleDetectionDeleteRef = useRef<(id: number) => void>(() => {})
  const handleKeyframeToggleRef = useRef<(id: number) => void>(() => {})

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      switch (e.key) {
        case " ":
          e.preventDefault()
          setPlaying(!isPlayingRef.current)
          break
        case "ArrowLeft":
          e.preventDefault()
          if (e.shiftKey) {
            setFrame(Math.max(0, currentFrameRef.current - 10))
          } else {
            setFrame(Math.max(0, currentFrameRef.current - 1))
          }
          break
        case "ArrowRight":
          e.preventDefault()
          if (e.shiftKey) {
            setFrame(Math.min(totalFramesRef.current - 1, currentFrameRef.current + 10))
          } else {
            setFrame(Math.min(totalFramesRef.current - 1, currentFrameRef.current + 1))
          }
          break
        case "Home":
          e.preventDefault()
          setFrame(0)
          break
        case "End":
          e.preventDefault()
          setFrame(totalFramesRef.current - 1)
          break
        case "Escape":
          e.preventDefault()
          onSelect(null)
          setTool("select")
          break
        case "v": case "V":
          if (!e.ctrlKey && !e.metaKey) setTool("select")
          break
        case "b": case "B":
          if (!e.ctrlKey && !e.metaKey) setTool("box")
          break
        case "k": case "K":
          // K = toggle keyframe on selected detection
          if (!e.ctrlKey && !e.metaKey && selectedDetectionIdRef.current !== null) {
            handleKeyframeToggleRef.current(selectedDetectionIdRef.current)
          }
          break
        case "z": case "Z":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            if (e.shiftKey) {
              redo()
            } else {
              undo()
            }
          }
          break
        case "y": case "Y":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            redo()
          }
          break
        case "Delete": case "Backspace":
          if (selectedDetectionIdRef.current !== null)
            handleDetectionDeleteRef.current(selectedDetectionIdRef.current)
          break
        case "[":
          // Jump to selected track start frame
          if (selectedTrackIdRef.current !== null) {
            const t = tracksRef.current.find((tr) => tr.id === selectedTrackIdRef.current)
            if (t) { e.preventDefault(); setFrame(t.start_frame) }
          }
          break
        case "]":
          // Jump to selected track end frame
          if (selectedTrackIdRef.current !== null) {
            const t = tracksRef.current.find((tr) => tr.id === selectedTrackIdRef.current)
            if (t) { e.preventDefault(); setFrame(t.end_frame) }
          }
          break
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo])

  // ========== 공통 리프레시 ==========
  const refreshAll = useCallback(() => {
    setSaving(true)
    Promise.all([
      loadDetections(),
      new Promise<void>((r) => { setSideRefreshKey((k) => k + 1); r() }),
    ]).finally(() => setSaving(false))
  }, [loadDetections])

  // ========== CRUD 핸들러 (with Undo) ==========
  const handleCreate = async (det: {
    frame_idx: number; x: number; y: number; w: number; h: number; class_name: string
  }) => {
    try {
      const created = await api.post<Detection>(`/videos/${vid}/detections`, { ...det, is_keyframe: true })
      let lastCreatedId = created.id
      const detData = { ...det, is_keyframe: true }

      pushUndo({
        description: "Create detection",
        undo: async () => {
          await api.delete(`/detections/${lastCreatedId}`)
          refreshAll()
        },
        redo: async () => {
          const recreated = await api.post<Detection>(`/videos/${vid}/detections`, detData)
          lastCreatedId = recreated.id
          refreshAll()
        },
      })
      refreshAll()
    } catch { toast.error("Detection 생성 실패") }
  }

  const handleUpdate = async (
    id: number,
    bbox: { x: number; y: number; w: number; h: number },
  ) => {
    const det = detections.find((d) => d.id === id)
    if (!det) return
    const oldBbox = { x: det.x, y: det.y, w: det.w, h: det.h }
    try {
      await api.patch(`/detections/${id}`, bbox)
      pushUndo({
        description: "Move/resize detection",
        undo: async () => {
          await api.patch(`/detections/${id}`, oldBbox)
          loadDetections()
        },
        redo: async () => {
          await api.patch(`/detections/${id}`, bbox)
          loadDetections()
        },
      })
      loadDetections()
    } catch { toast.error("Detection 수정 실패") }
  }

  const handleDelete = async (id: number) => {
    const det = detections.find((d) => d.id === id)
    if (!det) return
    try {
      await api.delete(`/detections/${id}`)
      let deletedId = id
      const detData = {
        frame_idx: det.frame_idx,
        x: det.x, y: det.y, w: det.w, h: det.h,
        class_name: det.class_name,
        is_keyframe: det.is_keyframe,
      }

      pushUndo({
        description: "Delete detection",
        undo: async () => {
          const recreated = await api.post<Detection>(`/videos/${vid}/detections`, detData)
          deletedId = recreated.id
          refreshAll()
        },
        redo: async () => {
          await api.delete(`/detections/${deletedId}`)
          refreshAll()
        },
      })
      setSelectedDetectionId(null)
      refreshAll()
    } catch { toast.error("Detection 삭제 실패") }
  }
  handleDetectionDeleteRef.current = handleDelete

  const handleKeyframeToggle = async (id: number) => {
    const det = detections.find((d) => d.id === id)
    if (!det) return
    const wasKeyframe = det.is_keyframe
    try {
      await api.patch(`/detections/${id}`, { is_keyframe: !wasKeyframe })
      pushUndo({
        description: "Toggle keyframe",
        undo: async () => {
          await api.patch(`/detections/${id}`, { is_keyframe: wasKeyframe })
          loadDetections()
        },
        redo: async () => {
          await api.patch(`/detections/${id}`, { is_keyframe: !wasKeyframe })
          loadDetections()
        },
      })
      loadDetections()
    } catch { toast.error("키프레임 토글 실패") }
  }
  handleKeyframeToggleRef.current = handleKeyframeToggle

  const handleClassChange = async (id: number, className: string) => {
    const det = detections.find((d) => d.id === id)
    if (!det) return
    const oldClassName = det.class_name
    try {
      await api.patch(`/detections/${id}`, { class_name: className })
      pushUndo({
        description: "Change class",
        undo: async () => {
          await api.patch(`/detections/${id}`, { class_name: oldClassName })
          loadDetections()
        },
        redo: async () => {
          await api.patch(`/detections/${id}`, { class_name: className })
          loadDetections()
        },
      })
      loadDetections()
    } catch { toast.error("클래스 변경 실패") }
  }

  const handleDeleteAllOnFrame = async (fi: number) => {
    const frameDets = detections.filter((d) => d.frame_idx === fi)
    if (frameDets.length === 0) return

    const savedDets = frameDets.map((d) => ({
      frame_idx: d.frame_idx,
      x: d.x, y: d.y, w: d.w, h: d.h,
      class_name: d.class_name,
      is_keyframe: d.is_keyframe,
    }))
    let savedIds = frameDets.map((d) => d.id)

    for (const d of frameDets) {
      try { await api.delete(`/detections/${d.id}`) } catch {}
    }

    pushUndo({
      description: "Delete all on frame",
      undo: async () => {
        const newIds: number[] = []
        for (const detData of savedDets) {
          const created = await api.post<Detection>(`/videos/${vid}/detections`, detData)
          newIds.push(created.id)
        }
        savedIds = newIds
        refreshAll()
      },
      redo: async () => {
        for (const dId of savedIds) {
          try { await api.delete(`/detections/${dId}`) } catch {}
        }
        refreshAll()
      },
    })
    setSelectedDetectionId(null)
    refreshAll()
  }

  const onSelect = (id: number | null) => setSelectedDetectionId(id)

  // 데이터 수집
  const defaultClass = classes[0] ?? "person"
  const selectedDet = detections.find((d) => d.id === selectedDetectionId)

  // Properties 패널 데이터
  const selectedTrack = selectedDet?.track_id
    ? (tracks.find((t) => t.id === selectedDet.track_id) ?? { id: selectedDet.track_id, identity_id: null })
    : null
  const selectedIdentityForDet = selectedTrack && 'identity_id' in selectedTrack && selectedTrack.identity_id != null
    ? identities.find((i) => i.id === (selectedTrack as Track).identity_id)
    : null

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* ===== TopBar ===== */}
      <header className="flex items-center justify-between px-4 py-1.5 border-b border-border text-sm flex-shrink-0 bg-card">
        <div className="flex items-center gap-3 relative">
          <button
            onClick={() => navigate("/")}
            className="text-primary hover:text-primary/80 transition-colors"
            title="프로젝트 목록"
          >
            <Logo className="w-5 h-5" />
          </button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors text-base"
            title="메뉴"
          >
            ≡
          </button>
          {menuOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 min-w-[140px] bg-popover border border-border rounded-md shadow-lg py-1 text-xs">
              <button onClick={() => { navigate("/"); setMenuOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-accent">프로젝트 홈</button>
              <button onClick={() => { navigate(`/projects/${pid}/gallery`); setMenuOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-accent">Crop Gallery</button>
              <div className="border-t border-border my-1" />
              <button onClick={() => { setShowExport(true); setMenuOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-accent">내보내기</button>
            </div>
          )}
          <span className="font-semibold">{projectName || `Project #${pid}`}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground text-xs">
            {videoMeta ? `${videoMeta.width}×${videoMeta.height} · ${videoMeta.fps.toFixed(0)}fps` : `Video #${vid}`}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className={saving ? "text-yellow-400 animate-pulse" : "text-green-400"}>{saving ? "저장 중..." : "저장됨 ✓"}</span>
          <button
            onClick={() => navigate(`/projects/${pid}/gallery`)}
            className="px-2.5 py-1 rounded border border-border hover:bg-accent transition-colors"
            title="Crop Gallery"
          >
            🖼 Gallery
          </button>
          <button
            onClick={() => setShowInference(true)}
            className="px-2.5 py-1 rounded border border-border hover:bg-accent transition-colors"
          >
            ⚡ AI
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="px-2.5 py-1 rounded border border-border hover:bg-accent transition-colors"
          >
            ⬇ Export
          </button>
        </div>
      </header>

      {/* ===== 메인 영역: 캔버스 + 사이드패널 ===== */}
      <div className="flex flex-1 overflow-hidden">
        {/* VideoCanvas */}
        <div className="flex-1 overflow-hidden">
          <VideoCanvas
            videoId={vid}
            frameIdx={currentFrame}
            detections={detections}
            videoWidth={videoMeta?.width ?? 1920}
            videoHeight={videoMeta?.height ?? 1080}
            tool={tool}
            selectedDetectionId={selectedDetectionId}
            defaultClass={defaultClass}
            classes={classes}
            onSelect={setSelectedDetectionId}
            onCreate={handleCreate}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onKeyframeToggle={handleKeyframeToggle}
            onClassChange={handleClassChange}
            onDeleteAllOnFrame={handleDeleteAllOnFrame}
            tracks={tracks}
          />
        </div>

        {/* SidePanel */}
        <aside className="w-60 flex-shrink-0 border-l border-border flex flex-col overflow-hidden bg-card">
          {/* 탭 */}
          <div className="flex border-b border-border text-xs flex-shrink-0">
            {(["identities", "tracks"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSideTab(tab)}
                className={`flex-1 py-2 px-1 capitalize transition-colors ${
                  sideTab === tab
                    ? "border-b-2 border-primary font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "identities" ? "Identities" : "Tracks"}
              </button>
            ))}
          </div>

          {/* Identity/Track 트리 */}
          <div className="flex-1 overflow-auto">
            <TrackList
              projectId={pid}
              videoId={vid}
              currentFrame={currentFrame}
              selectedIdentityId={selectedIdentityId}
              selectedTrackId={selectedTrackId}
              defaultClass={defaultClass}
              onSelectIdentity={selectIdentity}
              onSelectTrack={selectTrack}
              onFrameChange={setFrame}
              onRefresh={() => setSideRefreshKey((k) => k + 1)}
              refreshKey={sideRefreshKey}
            />
          </div>

          {/* Properties 패널 */}
          <div className="border-t border-border p-3 flex flex-col gap-2 text-xs flex-shrink-0">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Properties
            </p>
            {selectedDet ? (
              <div className="flex flex-col gap-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Class</span>
                  <span className="text-foreground font-medium">{selectedDet.class_name}</span>
                </div>
                {selectedTrack && (
                  <div className="flex justify-between">
                    <span>Track</span>
                    <span className="text-foreground">#{selectedTrack.id}</span>
                  </div>
                )}
                {selectedIdentityForDet && (
                  <div className="flex justify-between">
                    <span>Identity</span>
                    <span className="text-foreground truncate max-w-[100px]" title={selectedIdentityForDet.label ?? `#${selectedIdentityForDet.id}`}>
                      {selectedIdentityForDet.label ?? `#${selectedIdentityForDet.id}`}
                    </span>
                  </div>
                )}
                {selectedDet.is_keyframe && selectedDet.track_id && (
                  <div className="flex flex-col gap-1 mt-1 pt-1 border-t border-border/50">
                    <p className="text-[10px] text-muted-foreground">보간 범위</p>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        placeholder="시작"
                        value={interpFrameStart}
                        onChange={(e) => setInterpFrameStart(e.target.value)}
                        className="flex-1 min-w-0 bg-background border border-border rounded px-1 py-0.5 text-[10px] text-foreground outline-none focus:border-primary"
                      />
                      <input
                        type="number"
                        placeholder="끝"
                        value={interpFrameEnd}
                        onChange={(e) => setInterpFrameEnd(e.target.value)}
                        className="flex-1 min-w-0 bg-background border border-border rounded px-1 py-0.5 text-[10px] text-foreground outline-none focus:border-primary"
                      />
                    </div>
                    <button
                      disabled={interpRunning || !interpFrameStart || !interpFrameEnd}
                      onClick={async () => {
                        const trackId = selectedDet.track_id!
                        setInterpRunning(true)
                        setSaving(true)
                        try {
                          const res = await api.post<{ created_count: number }>(`/videos/${vid}/detections/interpolate`, {
                            track_id: trackId,
                            frame_start: Number(interpFrameStart),
                            frame_end: Number(interpFrameEnd),
                          })
                          refreshAll()
                          toast.success(`보간 완료: ${res.created_count}개 detection 생성됨`)
                          setInterpFrameStart("")
                          setInterpFrameEnd("")
                        } catch (e: unknown) {
                          toast.error(`보간 실패: ${e instanceof Error ? e.message : String(e)}`)
                        } finally {
                          setInterpRunning(false)
                          setSaving(false)
                        }
                      }}
                      className="w-full py-1 rounded border border-blue-500/50 text-blue-400 text-[10px] hover:bg-blue-500/10 transition-colors disabled:opacity-40"
                    >
                      {interpRunning ? "보간 중…" : "키프레임 간 보간"}
                    </button>
                  </div>
                )}
              </div>
            ) : selectedTrackId !== null ? (() => {
              const t = tracks.find((tr) => tr.id === selectedTrackId)
              if (!t) return <p className="text-muted-foreground">Track #{selectedTrackId}</p>
              const ident = t.identity_id != null ? identities.find((i) => i.id === t.identity_id) : null
              return (
                <div className="flex flex-col gap-1 text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Track</span>
                    <span className="text-foreground font-medium">#{t.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Frames</span>
                    <span className="text-foreground">{t.start_frame} ~ {t.end_frame}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Detections</span>
                    <span className="text-foreground">{t.detection_count}</span>
                  </div>
                  {ident && (
                    <div className="flex justify-between">
                      <span>Identity</span>
                      <span className="text-foreground truncate max-w-[100px]">{ident.label ?? `#${ident.id}`}</span>
                    </div>
                  )}
                </div>
              )
            })() : selectedIdentityId !== null ? (() => {
              const ident = identities.find((i) => i.id === selectedIdentityId)
              if (!ident) return <p className="text-muted-foreground">Identity #{selectedIdentityId}</p>
              return (
                <div className="flex flex-col gap-1 text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Identity</span>
                    <span className="text-foreground font-medium">{ident.label ?? `#${ident.id}`}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Class</span>
                    <span className="text-foreground">{ident.class_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tracks</span>
                    <span className="text-foreground">{ident.track_count}</span>
                  </div>
                </div>
              )
            })() : (
              <p className="text-muted-foreground">선택 없음</p>
            )}
          </div>
        </aside>
      </div>

      {/* ===== Timeline ===== */}
      <div className="flex-shrink-0 border-t border-border">
        <Timeline
          currentFrame={currentFrame}
          totalFrames={totalFrames}
          fps={fps}
          detections={detections}
          onChange={setFrame}
          tracks={tracks}
          identities={identities}
        />
      </div>

      {/* ===== ControlBar ===== */}
      <div className="flex-shrink-0 border-t border-border px-3 py-1 flex items-center justify-between text-xs bg-card">
        {/* 재생 컨트롤 */}
        <div className="flex items-center gap-1">
          <button onClick={() => setFrame(0)} className="p-1.5 hover:bg-accent rounded transition-colors" title="첨 프레임 (Home)">⏮</button>
          <button onClick={() => setFrame(Math.max(0, currentFrame - 1))} className="p-1.5 hover:bg-accent rounded transition-colors" title="이전 프레임 (←)">◄</button>
          <button onClick={() => setPlaying(!isPlaying)} className="px-3 py-1 hover:bg-accent rounded transition-colors font-medium" title="재생/일시정지 (Space)">{isPlaying ? "⏸" : "▶"}</button>
          <button onClick={() => setFrame(Math.min(totalFrames - 1, currentFrame + 1))} className="p-1.5 hover:bg-accent rounded transition-colors" title="다음 프레임 (→)">►</button>
          <button onClick={() => setFrame(totalFrames - 1)} className="p-1.5 hover:bg-accent rounded transition-colors" title="마지막 프레임 (End)">⏭</button>
          {/* 속도 조절 */}
          <select
            value={playbackRate}
            onChange={(e) => setPlaybackRate(Number(e.target.value))}
            className="ml-2 bg-background border border-border rounded px-1 py-0.5 text-foreground text-xs cursor-pointer"
            title="재생 속도"
          >
            {[0.25, 0.5, 1, 2, 4].map((r) => (
              <option key={r} value={r}>{r}x</option>
            ))}
          </select>
        </div>

        {/* 프레임 입력 + 타임코드 */}
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="font-mono">
            {fps > 0 ? (() => {
              const totalSec = currentFrame / fps
              const h = Math.floor(totalSec / 3600)
              const m = Math.floor((totalSec % 3600) / 60)
              const s = Math.floor(totalSec % 60)
              const f = currentFrame % Math.round(fps)
              return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}:${String(f).padStart(2,"0")}`
            })() : "00:00:00:00"}
          </span>
          <span>·</span>
          <input
            type="number"
            value={currentFrame}
            min={0}
            max={totalFrames - 1}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!isNaN(v)) setFrame(Math.max(0, Math.min(totalFrames - 1, v)))
            }}
            className="w-16 text-center bg-background border border-border rounded px-1 py-0.5 text-foreground"
          />
          <span>/ {totalFrames > 0 ? totalFrames - 1 : 0}</span>
        </div>

        {/* 도구 선택 */}
        <div className="flex items-center gap-1">
          {([
            { id: "select" as Tool, label: "🖱 선택", key: "V" },
            { id: "box" as Tool, label: "⬛ 박스", key: "B" },
          ] as const).map(({ id, label, key }) => (
            <button
              key={id}
              onClick={() => setTool(id)}
              title={`${label} (${key})`}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                tool === id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {showExport && (
        <ExportDialog projectId={pid} onClose={() => setShowExport(false)} />
      )}
      {showInference && (
        <InferencePanel projectId={pid} videoId={vid} onClose={() => setShowInference(false)} />
      )}
    </div>
  )
}
