/**
 * TrackList — Identity > Track tree with full management UI.
 *
 * Features:
 *  - "New Identity" button — creates an identity via API
 *  - Identity label inline edit (double-click)
 *  - Identity delete (hover × button) — AlertDialog confirmation
 *  - Track right-click context menu:
 *      Assign to Identity (sub-list), Split at current frame,
 *      Merge with selected track, Delete track — AlertDialog confirmation
 */
import { useEffect, useState, useCallback, useRef } from "react"
import { toast } from "sonner"
import { api, getAllPaginated } from "@/api/client"
import type { Identity, Track } from "@/types"
import { Pencil, MoreHorizontal, X, Plus, Zap } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// ---- colour helpers (mirrors VideoCanvas palette) ----
const PALETTE = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
  "#06b6d4", "#a855f7", "#84cc16", "#fb923c",
]
function trackColor(id: number): string {
  return PALETTE[Math.abs(id) % PALETTE.length]
}

// ---- context menu state ----
interface CtxMenu {
  trackId: number
  x: number
  y: number
}

interface Props {
  mode?: "identities" | "tracks"
  projectId: number
  videoId: number
  currentFrame: number        // needed for "split at current frame"
  selectedIdentityId: number | null
  selectedTrackId: number | null
  defaultClass: string        // default class_name for new identities
  onSelectIdentity: (id: number | null) => void
  onSelectTrack: (id: number | null) => void
  onFrameChange: (frame: number) => void
  onRefresh?: () => void      // called after mutations that affect canvas
  refreshKey: number
}

export default function TrackList({
  mode = "identities",
  projectId, videoId, currentFrame,
  selectedIdentityId, selectedTrackId,
  defaultClass,
  onSelectIdentity, onSelectTrack, onFrameChange,
  onRefresh, refreshKey,
}: Props) {
  const [identities, setIdentities] = useState<Identity[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)

  // inline label edit
  const [editingIdentityId, setEditingIdentityId] = useState<number | null>(null)
  const [editLabel, setEditLabel] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)

  // context menu
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const ctxRef = useRef<HTMLDivElement>(null)

  // assign sub-menu
  const [assigningTrackId, setAssigningTrackId] = useState<number | null>(null)

  // ---- AlertDialog state ----
  const [deleteIdentityTarget, setDeleteIdentityTarget] = useState<number | null>(null)
  const [deleteTrackTarget, setDeleteTrackTarget] = useState<number | null>(null)

  // ---- data load ----
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ir, tr] = await Promise.all([
        getAllPaginated<Identity>(`/projects/${projectId}/identities`),
        getAllPaginated<Track>(`/projects/${projectId}/tracks?video_id=${videoId}`),
      ])
      setIdentities(ir)
      setTracks(tr)
    } catch {}
    finally { setLoading(false) }
  }, [projectId, videoId])

  useEffect(() => { load() }, [load, refreshKey])

  // close context menu on outside click
  useEffect(() => {
    if (!ctx) return
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtx(null)
        setAssigningTrackId(null)
      }
    }
    window.addEventListener("mousedown", handler)
    return () => window.removeEventListener("mousedown", handler)
  }, [ctx])

  // focus inline edit input when it mounts
  useEffect(() => {
    if (editingIdentityId !== null) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingIdentityId])

  // ---- helpers ----
  const tracksByIdentity = (id: number) => tracks.filter((t) => t.identity_id === id)
  const unassigned = tracks.filter((t) => t.identity_id === null)
  const sortedTracks = [...tracks].sort((a, b) => {
    if (a.identity_id === null && b.identity_id !== null) return 1
    if (a.identity_id !== null && b.identity_id === null) return -1
    return a.start_frame - b.start_frame || a.id - b.id
  })

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // ---- identity mutations ----
  const createIdentity = async () => {
    try {
      const identity = await api.post<Identity>(`/projects/${projectId}/identities`, {
        class_name: defaultClass,
        label: null,
      })
      setIdentities((prev) => [...prev, identity])
      // auto-expand and start editing label immediately
      setExpanded((prev) => new Set([...prev, identity.id]))
      setEditLabel("")
      setEditingIdentityId(identity.id)
    } catch {}
  }

  const commitLabelEdit = async (identityId: number) => {
    const label = editLabel.trim() || null
    setEditingIdentityId(null)
    try {
      const updated = await api.patch<Identity>(`/identities/${identityId}`, { label })
      setIdentities((prev) => prev.map((i) => (i.id === identityId ? updated : i)))
    } catch {}
  }

  const deleteIdentity = async (identityId: number) => {
    try {
      await api.delete(`/identities/${identityId}`)
      setIdentities((prev) => prev.filter((i) => i.id !== identityId))
      // tracks that were assigned to this identity become unassigned
      setTracks((prev) => prev.map((t) => t.identity_id === identityId ? { ...t, identity_id: null } : t))
      if (selectedIdentityId === identityId) onSelectIdentity(null)
      onRefresh?.()
    } catch {
      toast.error("Identity 삭제 실패")
    }
  }

  // ---- track mutations ----
  const assignTrackToIdentity = async (trackId: number, identityId: number | null) => {
    setCtx(null)
    setAssigningTrackId(null)
    try {
      const updated = await api.patch<Track>(`/tracks/${trackId}`, { identity_id: identityId })
      setTracks((prev) => prev.map((t) => (t.id === trackId ? updated : t)))
      onRefresh?.()
    } catch {
      toast.error("Identity 할당 실패")
    }
  }

  const splitTrack = async (trackId: number) => {
    setCtx(null)
    try {
      const result = await api.post<{ track_a: Track; track_b: Track }>(
        `/tracks/${trackId}/split`,
        { split_frame: currentFrame },
      )
      setTracks((prev) => {
        const without = prev.filter((t) => t.id !== trackId)
        return [...without, result.track_a, result.track_b]
      })
      onRefresh?.()
      toast.success(`Track #${trackId} 분리 완료 → #${result.track_a.id}, #${result.track_b.id}`)
    } catch (e: unknown) {
      toast.error(`Split 실패: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const mergeWithSelected = async (trackId: number) => {
    setCtx(null)
    if (selectedTrackId === null || selectedTrackId === trackId) return
    try {
      const result = await api.post<Track>("/tracks/merge", {
        track_id_a: selectedTrackId,
        track_id_b: trackId,
      })
      setTracks((prev) => {
        const without = prev.filter((t) => t.id !== selectedTrackId && t.id !== trackId)
        return [...without, result]
      })
      onSelectTrack(result.id)
      onRefresh?.()
      toast.success(`Track 병합 완료 → #${result.id}`)
    } catch (e: unknown) {
      toast.error(`Merge 실패: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const deleteTrack = async (trackId: number) => {
    setCtx(null)
    try {
      await api.delete(`/tracks/${trackId}`)
      setTracks((prev) => prev.filter((t) => t.id !== trackId))
      if (selectedTrackId === trackId) onSelectTrack(null)
      onRefresh?.()
    } catch {
      toast.error("Track 삭제 실패")
    }
  }

  // ---- render helpers ----
  const handleTrackContextMenu = (e: React.MouseEvent, trackId: number) => {
    e.preventDefault()
    setCtx({ trackId, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 200) })
    setAssigningTrackId(null)
  }

  if (loading && identities.length === 0 && tracks.length === 0) {
    return <p className="text-xs text-muted-foreground p-3 text-center">로딩 중…</p>
  }

  const ctxTrack = ctx ? tracks.find((t) => t.id === ctx.trackId) : null
  const deleteIdentityName = deleteIdentityTarget !== null
    ? (identities.find(i => i.id === deleteIdentityTarget)?.label ?? `Identity #${deleteIdentityTarget}`)
    : ""

  return (
    <>
      {/* ---- AlertDialog: Identity 삭제 ---- */}
      <AlertDialog open={deleteIdentityTarget !== null} onOpenChange={(open) => !open && setDeleteIdentityTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Identity 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteIdentityName} 을(를) 삭제합니다. 소속 트랙은 미할당 상태로 남습니다. 계속하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteIdentityTarget !== null) deleteIdentity(deleteIdentityTarget)
                setDeleteIdentityTarget(null)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- AlertDialog: Track 삭제 ---- */}
      <AlertDialog open={deleteTrackTarget !== null} onOpenChange={(open) => !open && setDeleteTrackTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Track 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              Track #{deleteTrackTarget} 과 소속 detection을 모두 삭제합니다. 계속하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTrackTarget !== null) deleteTrack(deleteTrackTarget)
                setDeleteTrackTarget(null)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex flex-col overflow-auto text-sm">
        {mode === "identities" && (
          <button
            onClick={createIdentity}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-primary hover:bg-accent transition-colors border-b border-border"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Identity</span>
          </button>
        )}

        {mode === "tracks" && (
          <div className="px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
            Tracks ({tracks.length})
          </div>
        )}

        {mode === "identities" && identities.map((identity) => {
          const itracks = tracksByIdentity(identity.id)
          const isExpanded = expanded.has(identity.id)
          const isSelected = identity.id === selectedIdentityId
          const isEditing = editingIdentityId === identity.id

          return (
            <div key={identity.id}>
              {/* Identity row */}
              <div
                onClick={() => {
                  if (isEditing) return
                  onSelectIdentity(identity.id)
                  if (!isExpanded) toggleExpanded(identity.id)
                }}
                className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-accent transition-colors ${isSelected ? "bg-accent" : ""}`}
              >
                {/* expand toggle */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleExpanded(identity.id) }}
                  className="w-4 text-muted-foreground flex-shrink-0 text-xs"
                >
                  {itracks.length > 0 ? (isExpanded ? "▾" : "▸") : "·"}
                </button>

                {/* colour dot */}
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: trackColor(identity.id) }}
                />

                {/* label — inline edit on double-click */}
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onBlur={() => commitLabelEdit(identity.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitLabelEdit(identity.id)
                      if (e.key === "Escape") setEditingIdentityId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Identity 이름"
                    className="flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0 text-xs outline-none"
                  />
                ) : (
                  <span
                    className="flex-1 truncate font-medium text-xs"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setEditLabel(identity.label ?? "")
                      setEditingIdentityId(identity.id)
                    }}
                    title="더블클릭으로 이름 편집"
                  >
                    {identity.label ?? `Identity #${identity.id}`}
                  </span>
                )}

                <span className="text-[10px] text-muted-foreground flex-shrink-0">{identity.class_name}</span>

                {!isEditing && (
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditLabel(identity.label ?? "")
                        setEditingIdentityId(identity.id)
                      }}
                      className="w-4 h-4 flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                      title="이름 편집"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteIdentityTarget(identity.id)
                      }}
                      className="w-4 h-4 flex items-center justify-center rounded hover:bg-destructive/20 text-destructive"
                      title="Identity 삭제"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Track rows under identity */}
              {isExpanded && itracks.map((track) => {
                const isTSelected = track.id === selectedTrackId
                return (
                  <div
                    key={track.id}
                    onContextMenu={(e) => handleTrackContextMenu(e, track.id)}
                    onClick={() => { onSelectTrack(track.id); onFrameChange(track.start_frame) }}
                    className={`group/track flex items-center gap-2 pl-8 pr-2 py-1 cursor-pointer hover:bg-accent/60 transition-colors text-xs ${isTSelected ? "bg-accent/40" : ""}`}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: trackColor(track.id) }}
                    />
                    <span className="flex-1 text-muted-foreground">Track #{track.id}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      f{track.start_frame}–{track.end_frame}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleTrackContextMenu(e, track.id)
                      }}
                      className="opacity-0 group-hover/track:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-opacity flex-shrink-0"
                      title="트랙 메뉴"
                    >
                      <MoreHorizontal className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })}

        {mode === "identities" && unassigned.length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider border-t border-border mt-1">
              미할당 ({unassigned.length})
            </div>
            {unassigned.map((track) => (
              <div
                key={track.id}
                onContextMenu={(e) => handleTrackContextMenu(e, track.id)}
                onClick={() => { onSelectTrack(track.id); onFrameChange(track.start_frame) }}
                className={`group/track flex items-center gap-2 pl-6 pr-2 py-1 cursor-pointer hover:bg-accent/60 text-xs ${track.id === selectedTrackId ? "bg-accent/40" : ""}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground flex-shrink-0" />
                <span className="flex-1 text-muted-foreground">Track #{track.id}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  f{track.start_frame}–{track.end_frame}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleTrackContextMenu(e, track.id)
                  }}
                  className="opacity-0 group-hover/track:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-opacity flex-shrink-0"
                  title="트랙 메뉴"
                >
                  <MoreHorizontal className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {mode === "tracks" && sortedTracks.map((track) => {
          const identity = track.identity_id != null
            ? identities.find((item) => item.id === track.identity_id)
            : null

          return (
            <div
              key={track.id}
              onContextMenu={(e) => handleTrackContextMenu(e, track.id)}
              onClick={() => {
                onSelectTrack(track.id)
                onSelectIdentity(identity?.id ?? null)
                onFrameChange(track.start_frame)
              }}
              className={`group/track flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/60 text-xs border-b border-border/50 ${
                track.id === selectedTrackId ? "bg-accent/40" : ""
              }`}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: track.identity_id == null ? "#94a3b8" : trackColor(track.identity_id) }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-medium">Track #{track.id}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    f{track.start_frame}-{track.end_frame}
                  </span>
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {identity ? `${identity.label ?? `Identity #${identity.id}`} · ${identity.class_name}` : "미할당 Identity"}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleTrackContextMenu(e, track.id)
                }}
                className="opacity-0 group-hover/track:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-opacity flex-shrink-0"
                title="트랙 메뉴"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}

        {identities.length === 0 && unassigned.length === 0 && mode === "identities" && (
          <div className="p-4 text-center">
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              아직 Identity / Track이 없습니다.
            </p>
            <div className="flex flex-col gap-1.5 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-2 px-2">
                <Zap className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="text-left">AI 추론으로 자동 생성</span>
              </div>
              <div className="flex items-center gap-2 px-2">
                <kbd className="bg-accent rounded px-1 py-0.5 text-[9px] font-mono">B</kbd>
                <span className="text-left">박스 도구로 직접 그리기</span>
              </div>
              <div className="flex items-center gap-2 px-2">
                <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="text-left">위 버튼으로 Identity 추가</span>
              </div>
            </div>
          </div>
        )}

        {mode === "tracks" && tracks.length === 0 && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            아직 Track이 없습니다.
          </div>
        )}
      </div>

      {/* ---- Context menu (portal-style, fixed position) ---- */}
      {ctx && ctxTrack && (
        <div
          ref={ctxRef}
          style={{ top: ctx.y, left: ctx.x }}
          className="fixed z-50 min-w-[160px] bg-popover border border-border rounded-md shadow-lg py-1 text-xs"
        >
          {/* Assign to Identity */}
          <div className="relative">
            <button
              onClick={() => setAssigningTrackId(assigningTrackId === ctx.trackId ? null : ctx.trackId)}
              className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center justify-between"
            >
              <span>Identity에 할당</span>
              <span className="text-muted-foreground">▸</span>
            </button>

            {assigningTrackId === ctx.trackId && (
              <div className="absolute left-full top-0 min-w-[140px] bg-popover border border-border rounded-md shadow-lg py-1">
                {/* Unassign option */}
                {ctxTrack.identity_id !== null && (
                  <button
                    onClick={() => assignTrackToIdentity(ctx.trackId, null)}
                    className="w-full text-left px-3 py-1.5 hover:bg-accent text-muted-foreground"
                  >
                    할당 해제
                  </button>
                )}
                {identities.length === 0 && (
                  <p className="px-3 py-1.5 text-muted-foreground">Identity 없음</p>
                )}
                {identities.map((identity) => (
                  <button
                    key={identity.id}
                    onClick={() => assignTrackToIdentity(ctx.trackId, identity.id)}
                    className={`w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 ${ctxTrack.identity_id === identity.id ? "text-primary font-medium" : ""}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: trackColor(identity.id) }}
                    />
                    <span className="truncate">{identity.label ?? `#${identity.id}`}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border my-1" />

          {/* Split at current frame */}
          <button
            onClick={() => splitTrack(ctx.trackId)}
            className="w-full text-left px-3 py-1.5 hover:bg-accent"
          >
            프레임 {currentFrame}에서 분리
          </button>

          {/* Merge with selected track */}
          {selectedTrackId !== null && selectedTrackId !== ctx.trackId && (
            <button
              onClick={() => mergeWithSelected(ctx.trackId)}
              className="w-full text-left px-3 py-1.5 hover:bg-accent"
            >
              Track #{selectedTrackId}과 병합
            </button>
          )}

          <div className="border-t border-border my-1" />

          {/* Delete track */}
          <button
            onClick={() => {
              setDeleteTrackTarget(ctx.trackId)
              setCtx(null)
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-accent text-destructive"
          >
            트랙 삭제
          </button>
        </div>
      )}
    </>
  )
}
