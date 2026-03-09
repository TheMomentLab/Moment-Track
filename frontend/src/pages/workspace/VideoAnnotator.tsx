import { useState, useEffect, useRef, useCallback } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { api, getAllPaginated } from "@/api/client"
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
import {
  Zap, LayoutGrid, Download, Square, MousePointer2,
  SkipBack, SkipForward, ChevronLeft, ChevronRight,
  Play, Pause, Star, Trash2, Keyboard, Target, ClipboardList,
} from "lucide-react"

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

  // Timeline 용 tracks/identities/coverage
  const [tracks, setTracks] = useState<Track[]>([])
  const [identities, setIdentities] = useState<Identity[]>([])
  const [trackCoverage, setTrackCoverage] = useState<Array<{ track_id: number; segments: [number, number][] }>>([])

  const [showShortcuts, setShowShortcuts] = useState(false)

  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return localStorage.getItem("mt_onboarding_dismissed") !== "1" } catch { return true }
  })
  const [onboardingStep, setOnboardingStep] = useState(0)
  const dismissOnboarding = () => {
    setShowOnboarding(false)
    try { localStorage.setItem("mt_onboarding_dismissed", "1") } catch {}
  }

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
    getAllPaginated<Detection>(
      `/videos/${vid}/detections?frame_start=${currentFrameRef.current}&frame_end=${currentFrameRef.current}`,
    )
      .then((items) => setDetections(items))
      .catch(() => setDetections([]))
  }, [vid])

  useEffect(() => {
    loadDetections()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vid, currentFrame])

  // Timeline 용 tracks/identities 로드
  const loadTracksAndIdentities = useCallback(() => {
    Promise.all([
      getAllPaginated<Track>(`/projects/${pid}/tracks?video_id=${vid}`),
      getAllPaginated<Identity>(`/projects/${pid}/identities`),
    ])
      .then(([trackItems, identityItems]) => {
        setTracks(trackItems)
        setIdentities(identityItems)
      })
      .catch(() => {
        setTracks([])
        setIdentities([])
      })
    api
      .get<Array<{ track_id: number; segments: [number, number][] }>>(`/videos/${vid}/track-coverage`)
      .then((r) => setTrackCoverage(r))
      .catch(() => setTrackCoverage([]))
  }, [pid, vid])

  useEffect(() => {
    loadTracksAndIdentities()
  }, [loadTracksAndIdentities, sideRefreshKey])

  const refreshWorkspaceData = useCallback(async () => {
    await Promise.all([
      loadDetections(),
      loadTracksAndIdentities(),
    ])
  }, [loadDetections, loadTracksAndIdentities])

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
        case "?":
          e.preventDefault()
          setShowShortcuts((v) => !v)
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
    refreshWorkspaceData()
      .finally(() => {
        setSideRefreshKey((k) => k + 1)
        setSaving(false)
      })
  }, [refreshWorkspaceData])

  // ========== CRUD 핸들러 (with Undo) ==========
  const handleCreate = async (det: {
    frame_idx: number; x: number; y: number; w: number; h: number; class_name: string
  }) => {
    const targetTrackId = selectedTrackId != null && tracks.some((t) => t.id === selectedTrackId)
      ? selectedTrackId
      : null
    const targetIdentityId = targetTrackId == null ? selectedIdentityId : null

    try {
      const payload = {
        ...det,
        is_keyframe: true,
        ...(targetTrackId != null && { track_id: targetTrackId }),
        ...(targetIdentityId != null && { identity_id: targetIdentityId }),
      }
      const created = await api.post<Detection>(`/videos/${vid}/detections`, payload)
      let lastCreatedId = created.id
      const detData = { ...payload }

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
      await refreshWorkspaceData()
      setSideRefreshKey((k) => k + 1)
      setSelectedDetectionId(created.id)
      selectTrack(created.track_id ?? null)
      if (targetIdentityId != null) {
        selectIdentity(targetIdentityId)
      }
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
          refreshWorkspaceData()
        },
        redo: async () => {
          await api.patch(`/detections/${id}`, bbox)
          refreshWorkspaceData()
        },
      })
      refreshWorkspaceData()
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
      selectTrack(null)
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
          refreshWorkspaceData()
        },
        redo: async () => {
          await api.patch(`/detections/${id}`, { is_keyframe: !wasKeyframe })
          refreshWorkspaceData()
        },
      })
      refreshWorkspaceData()
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
          refreshWorkspaceData()
        },
        redo: async () => {
          await api.patch(`/detections/${id}`, { class_name: className })
          refreshWorkspaceData()
        },
      })
      refreshWorkspaceData()
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

  const drawTarget = (() => {
    if (selectedTrackId != null && tracks.some((t) => t.id === selectedTrackId)) {
      const t = tracks.find((t) => t.id === selectedTrackId)!
      const ident = t.identity_id != null ? identities.find((i) => i.id === t.identity_id) : null
      const label = ident?.label ?? ident?.class_name ?? null
      return label ? `${label} / Track #${t.id}` : `Track #${t.id}`
    }
    if (selectedIdentityId != null) {
      const ident = identities.find((i) => i.id === selectedIdentityId)
      return ident ? (ident.label ?? `${ident.class_name} #${ident.id}`) : `Identity #${selectedIdentityId}`
    }
    return null
  })()

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
            onClick={() => navigate("/")}
            className="text-muted-foreground hover:text-foreground transition-colors text-xs"
          >
            ← Projects
          </button>
          <span className="text-muted-foreground">/</span>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="font-semibold hover:text-primary transition-colors"
            title="메뉴"
          >
            {projectName || `Project #${pid}`} ▾
          </button>
          {menuOpen && (
            <div className="absolute top-full left-8 mt-1 z-50 min-w-[140px] bg-popover border border-border rounded-md shadow-lg py-1 text-xs">
              <button onClick={() => { navigate(`/projects/${pid}/gallery`); setMenuOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-accent">Crop Gallery</button>
              <div className="border-t border-border my-1" />
              <button onClick={() => { setShowExport(true); setMenuOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-accent">내보내기</button>
            </div>
          )}
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
            <LayoutGrid className="inline w-3.5 h-3.5 -mt-px" /> Gallery
          </button>
          <button
            onClick={() => setShowInference(true)}
            className="px-2.5 py-1 rounded border border-border hover:bg-accent transition-colors flex items-center gap-1"
          >
            <Zap className="w-3.5 h-3.5" /> AI
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="px-2.5 py-1 rounded border border-border hover:bg-accent transition-colors flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </header>

      {/* ===== 메인 영역: 캔버스 + 사이드패널 ===== */}
      <div className="flex flex-1 overflow-hidden">
        {/* VideoCanvas */}
        <div className="flex-1 overflow-hidden relative">
          {videoMeta ? (
            <>
              <VideoCanvas
                videoId={vid}
                frameIdx={currentFrame}
                detections={detections}
                videoWidth={videoMeta.width}
                videoHeight={videoMeta.height}
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
              {detections.length === 0 && tracks.length === 0 && !isPlaying && tool !== "box" && !showInference && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="pointer-events-auto bg-card/90 backdrop-blur-sm border border-border rounded-lg p-6 max-w-xs text-center shadow-lg">
                    <p className="text-sm font-medium text-foreground mb-2">아직 어노테이션이 없습니다</p>
                    <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                      AI로 자동 추론하거나,<br />
                      <kbd className="bg-accent rounded px-1 py-0.5 text-[10px]">B</kbd> 키를 눌러 직접 박스를 그릴 수 있습니다.
                    </p>
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => setShowInference(true)}
                        className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                      >
                        <Zap className="inline w-3.5 h-3.5 -mt-px" /> AI 추론 시작
                      </button>
                      <button
                        onClick={() => setTool("box")}
                        className="px-3 py-1.5 rounded border border-border text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex items-center gap-1"
                      >
                        <Square className="w-3.5 h-3.5" /> 직접 그리기
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
              비디오 메타데이터를 불러오는 중입니다.
            </div>
          )}
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
              mode={sideTab}
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
          trackCoverage={trackCoverage}
        />
      </div>

      {/* ===== ControlBar ===== */}
      <div className="flex-shrink-0 border-t border-border px-3 py-1 flex items-center justify-between text-xs bg-card">
        {/* 재생 컨트롤 */}
        <div className="flex items-center gap-1">
          <button onClick={() => setFrame(0)} className="p-1.5 hover:bg-accent rounded transition-colors" title="첨 프레임 (Home)"><SkipBack className="w-3.5 h-3.5" /></button>
          <button onClick={() => setFrame(Math.max(0, currentFrame - 1))} className="p-1.5 hover:bg-accent rounded transition-colors" title="이전 프레임 (←)"><ChevronLeft className="w-3.5 h-3.5" /></button>
          <button onClick={() => setPlaying(!isPlaying)} className="p-1.5 hover:bg-accent rounded transition-colors" title="재생/일시정지 (Space)">{isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
          <button onClick={() => setFrame(Math.min(totalFrames - 1, currentFrame + 1))} className="p-1.5 hover:bg-accent rounded transition-colors" title="다음 프레임 (→)"><ChevronRight className="w-3.5 h-3.5" /></button>
          <button onClick={() => setFrame(totalFrames - 1)} className="p-1.5 hover:bg-accent rounded transition-colors" title="마지막 프레임 (End)"><SkipForward className="w-3.5 h-3.5" /></button>
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

        {/* 선택 액션 + 도구 + 타겟 + 도움말 */}
        <div className="flex items-center gap-1.5">
          {selectedDet && (
            <>
              <div className="flex items-center gap-0.5 border border-border rounded-md px-1 py-0.5 bg-accent/30">
                <button
                  onClick={() => handleKeyframeToggle(selectedDet.id)}
                  title="키프레임 토글 (K)"
                  className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                    selectedDet.is_keyframe
                      ? "bg-yellow-500/20 text-yellow-400"
                      : "hover:bg-accent text-muted-foreground"
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 ${selectedDet.is_keyframe ? "fill-current" : ""}`} />
                </button>
                <button
                  onClick={() => handleDelete(selectedDet.id)}
                  title="삭제 (Del)"
                  className="px-1.5 py-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                {classes.length > 1 && (
                  <select
                    value={selectedDet.class_name}
                    onChange={(e) => handleClassChange(selectedDet.id, e.target.value)}
                    className="bg-transparent border-none text-[10px] text-foreground cursor-pointer outline-none px-0.5"
                    title="클래스 변경"
                  >
                    {classes.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="w-px h-4 bg-border" />
            </>
          )}

          {[
            { id: "select" as Tool, label: "선택", key: "V", Icon: MousePointer2 },
            { id: "box" as Tool, label: "박스", key: "B", Icon: Square },
          ].map(({ id, label, key, Icon }) => (
            <button
              key={id}
              onClick={() => setTool(id)}
              title={`${label} (${key})`}
              className={`px-2 py-1 rounded text-xs transition-colors flex items-center gap-1 ${
                tool === id
                  ? "bg-primary text-primary-foreground font-medium ring-1 ring-primary/50"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
              <kbd className="text-[9px] opacity-60 ml-0.5">{key}</kbd>
            </button>
          ))}

          {tool === "box" && (
            <span className="text-[10px] text-muted-foreground border-l border-border pl-1.5 max-w-[160px] truncate">
              {drawTarget ? `→ ${drawTarget}` : "→ 새 객체"}
            </span>
          )}

          <div className="w-px h-4 bg-border ml-1" />
          <button
            onClick={() => setShowShortcuts(true)}
            title="단축키 안내 (?)"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors text-xs"
          >
            ?
          </button>
        </div>
      </div>
      {showExport && (
        <ExportDialog projectId={pid} onClose={() => setShowExport(false)} />
      )}
      {showInference && (
        <InferencePanel projectId={pid} videoId={vid} onClose={() => setShowInference(false)} />
      )}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Keyboard Shortcuts</h2>
              <button
                onClick={() => setShowShortcuts(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">Space</kbd>
                <span className="text-sm text-muted-foreground">재생/일시정지</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">← / →</kbd>
                <span className="text-sm text-muted-foreground">이전/다음 프레임</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">Shift+← / →</kbd>
                <span className="text-sm text-muted-foreground">±10 프레임</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">Home / End</kbd>
                <span className="text-sm text-muted-foreground">첫/마지막 프레임</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">B</kbd>
                <span className="text-sm text-muted-foreground">박스 그리기 모드</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">V</kbd>
                <span className="text-sm text-muted-foreground">선택 모드</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">K</kbd>
                <span className="text-sm text-muted-foreground">키프레임 토글</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">Delete</kbd>
                <span className="text-sm text-muted-foreground">선택 삭제</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">[ / ]</kbd>
                <span className="text-sm text-muted-foreground">트랙 시작/끝으로 이동</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">Ctrl+Z</kbd>
                <span className="text-sm text-muted-foreground">실행 취소</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">Ctrl+Shift+Z / Ctrl+Y</kbd>
                <span className="text-sm text-muted-foreground">다시 실행</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">Escape</kbd>
                <span className="text-sm text-muted-foreground">선택 해제</span>
              </div>
              <div className="flex items-start gap-3">
                <kbd className="font-mono bg-accent rounded px-1.5 py-0.5 text-xs text-foreground flex-shrink-0">?</kbd>
                <span className="text-sm text-muted-foreground">이 도움말</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {showOnboarding && videoMeta && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-popover border border-border rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
            {onboardingStep === 0 && (
              <>
                <h2 className="text-lg font-semibold text-foreground mb-2">Moment Track에 오신 것을 환영합니다</h2>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  비디오 어노테이션 도구입니다. 핵심 조작법을 빠르게 안내해 드릴게요.
                </p>
                <div className="flex flex-col gap-3 mb-5">
                  <div className="flex items-start gap-3">
                    <Zap className="w-5 h-5 flex-shrink-0 text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground">AI 자동 추론</p>
                      <p className="text-xs text-muted-foreground">상단 AI 버튼으로 객체 감지 · 트래킹 · ReID를 실행하세요.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Square className="w-5 h-5 flex-shrink-0 text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground">수동 박스 그리기</p>
                      <p className="text-xs text-muted-foreground"><kbd className="bg-accent rounded px-1 text-[10px]">B</kbd> 키로 박스 모드 → 드래그로 그리기. <kbd className="bg-accent rounded px-1 text-[10px]">V</kbd> 키로 선택 모드 복귀.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MousePointer2 className="w-5 h-5 flex-shrink-0 text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground">선택 & 편집</p>
                      <p className="text-xs text-muted-foreground">박스 클릭으로 선택, 우클릭으로 클래스 변경 · 삭제. 하단 바에서도 액션 가능.</p>
                    </div>
                  </div>
                </div>
              </>
            )}
            {onboardingStep === 1 && (
              <>
                <h2 className="text-lg font-semibold text-foreground mb-2">Track & Identity 관리</h2>
                <div className="flex flex-col gap-3 mb-5">
                  <div className="flex items-start gap-3">
                    <ClipboardList className="w-5 h-5 flex-shrink-0 text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground">사이드패널</p>
                      <p className="text-xs text-muted-foreground">오른쪽 패널에서 Identity와 Track을 관리합니다. 트랙의 메뉴 버튼으로 할당 · 분리 · 병합이 가능합니다.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Target className="w-5 h-5 flex-shrink-0 text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground">기존 객체에 박스 추가</p>
                      <p className="text-xs text-muted-foreground">사이드패널에서 Identity/Track을 선택한 뒤 박스를 그리면 해당 객체에 추가됩니다.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Keyboard className="w-5 h-5 flex-shrink-0 text-primary mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground">단축키</p>
                      <p className="text-xs text-muted-foreground">
                        <kbd className="bg-accent rounded px-1 text-[10px]">Space</kbd> 재생 &nbsp;
                        <kbd className="bg-accent rounded px-1 text-[10px]">←→</kbd> 프레임 이동 &nbsp;
                        <kbd className="bg-accent rounded px-1 text-[10px]">?</kbd> 전체 단축키
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                {[0, 1].map((i) => (
                  <div key={i} className={`w-2 h-2 rounded-full ${i === onboardingStep ? "bg-primary" : "bg-muted"}`} />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={dismissOnboarding}
                  className="px-3 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  건너뛰기
                </button>
                {onboardingStep < 1 ? (
                  <button
                    onClick={() => setOnboardingStep(1)}
                    className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                  >
                    다음
                  </button>
                ) : (
                  <button
                    onClick={dismissOnboarding}
                    className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                  >
                    시작하기
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
