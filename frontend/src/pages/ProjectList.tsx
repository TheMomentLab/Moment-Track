import { useEffect, useState, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/api/client"
import { toast } from "sonner"
import Logo from "@/components/Logo"
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

interface VideoSummary {
  id: number
}

interface Project {
  id: number
  name: string
  classes: string[]
  created_at: string
  video_count?: number
  total_frames?: number
  annotated_frames?: number
  first_video_id?: number | null
}

interface PaginatedResponse<T> {
  total: number
  items: T[]
}

export default function ProjectList() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; projectId: number } | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const res = await api.get<PaginatedResponse<Project>>("/projects")
      // 각 프로젝트의 첫 번째 비디오 ID를 조회
      const enriched = await Promise.all(
        res.items.map(async (project) => {
          try {
            const vids = await api.get<PaginatedResponse<VideoSummary>>(
              `/projects/${project.id}/videos?limit=1&offset=0`,
            )
            return { ...project, first_video_id: vids.items.length > 0 ? vids.items[0].id : null }
          } catch {
            return { ...project, first_video_id: null }
          }
        }),
      )
      setProjects(enriched)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProjects()
  }, [])

  useEffect(() => {
    if (!contextMenu) return

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest("[data-project-context-menu='true']")) return
      setContextMenu(null)
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null)
      }
    }

    window.addEventListener("mousedown", handleOutsideClick)
    window.addEventListener("keydown", handleEscape)
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick)
      window.removeEventListener("keydown", handleEscape)
    }
  }, [contextMenu])

  const handleDeleteConfirm = async () => {
    if (deleteTargetId === null) return

    setDeletingId(deleteTargetId)
    try {
      await api.delete("/projects/" + deleteTargetId)
      setProjects((prev) => prev.filter((p) => p.id !== deleteTargetId))
      setDeleteTargetId(null)
      setContextMenu(null)
      toast.success("프로젝트 삭제됨")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeletingId(null)
    }
  }

  const startRename = (id: number) => {
    const current = projects.find((p) => p.id === id)?.name ?? ""
    setRenameValue(current)
    setRenamingId(id)
    setContextMenu(null)
    setTimeout(() => renameInputRef.current?.select(), 50)
  }

  const commitRename = async () => {
    if (renamingId === null) return
    const trimmed = renameValue.trim()
    if (!trimmed) { setRenamingId(null); return }
    const current = projects.find((p) => p.id === renamingId)?.name ?? ""
    if (trimmed === current) { setRenamingId(null); return }
    try {
      await api.patch(`/projects/${renamingId}`, { name: trimmed })
      await fetchProjects()
      toast.success("이름 변경 완료")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rename failed")
    } finally {
      setRenamingId(null)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <AlertDialog open={deleteTargetId !== null} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>프로젝트 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              프로젝트와 관련 데이터가 삭제됩니다. 계속하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Logo className="w-8 h-8 text-primary" />
          <h1 className="text-xl font-bold tracking-tight">Moment Track</h1>
        </div>
        <button
          onClick={() => navigate("/projects/new")}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          + New Project
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6">
        {loading && (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            Loading…
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-64 text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
            <p className="text-lg">No projects yet</p>
            <button
              onClick={() => navigate("/projects/new")}
              className="px-4 py-2 rounded-md border border-border text-sm hover:bg-accent transition-colors"
            >
              Create your first project
            </button>
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => {
                  if (project.first_video_id != null) {
                    navigate("/projects/" + project.id + "/videos/" + project.first_video_id)
                  } else {
                    toast.info("비디오가 없습니다. 프로젝트에 비디오를 먼저 추가하세요.")
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({ x: e.clientX, y: e.clientY, projectId: project.id })
                }}
                className="group relative flex flex-col gap-2 rounded-lg border border-border bg-card p-4 cursor-pointer hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  {renamingId === project.id ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.stopPropagation(); void commitRename() }
                        if (e.key === "Escape") { e.stopPropagation(); setRenamingId(null) }
                      }}
                      onBlur={() => void commitRename()}
                      autoFocus
                      className="flex-1 bg-background border border-primary rounded px-1.5 py-0.5 text-sm font-semibold outline-none"
                    />
                  ) : (
                    <h2 className="font-semibold text-sm leading-tight line-clamp-2">{project.name}</h2>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTargetId(project.id)
                    }}
                    disabled={deletingId === project.id}
                    className="opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0 text-muted-foreground hover:text-destructive transition-opacity"
                    title="Delete project"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(project.created_at).toLocaleDateString()}
                </p>
                <p className="text-xs text-muted-foreground">비디오 {project.video_count ?? 0}개</p>
                {(project.total_frames ?? 0) > 0 && (() => {
                  const total = project.total_frames!
                  const done = project.annotated_frames ?? 0
                  const pct = Math.min(100, Math.round((done / total) * 100))
                  return (
                    <div className="flex flex-col gap-0.5">
                      <div className="w-full h-1.5 rounded-full bg-accent overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {done.toLocaleString()} / {total.toLocaleString()} frames ({pct}%)
                      </span>
                    </div>
                  )
                })()}
                {project.classes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {project.classes.slice(0, 4).map((cls) => (
                      <span
                        key={cls}
                        className="px-1.5 py-0.5 rounded text-xs bg-accent text-accent-foreground"
                      >
                        {cls}
                      </span>
                    ))}
                    {project.classes.length > 4 && (
                      <span className="text-xs text-muted-foreground">+{project.classes.length - 4}</span>
                    )}
                  </div>
                )}
                {/* Gallery shortcut */}
                <button
                  onClick={(e) => { e.stopPropagation(); navigate("/projects/" + project.id + "/gallery") }}
                  className="mt-1 text-[10px] text-muted-foreground hover:text-primary transition-colors text-left"
                >
                  🖼 Crop Gallery →
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {contextMenu && (
        <div
          data-project-context-menu="true"
          className="fixed z-50 min-w-32 rounded-md border border-border bg-popover p-1 shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              startRename(contextMenu.projectId)
            }}
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            이름 변경
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setDeleteTargetId(contextMenu.projectId)
              setContextMenu(null)
            }}
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-accent"
          >
            삭제
          </button>
        </div>
      )}
    </div>
  )
}
