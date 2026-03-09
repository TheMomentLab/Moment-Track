import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/api/client"
import Logo from "@/components/Logo"

interface UploadedVideo {
  id: number
}

interface PendingFile {
  id: string
  file: File
  width: number | null
  height: number | null
  durationSec: number | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

async function readVideoMeta(file: File): Promise<Pick<PendingFile, "width" | "height" | "durationSec">> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const video = document.createElement("video")
    video.preload = "metadata"
    video.src = objectUrl

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error("비디오 메타데이터를 읽을 수 없습니다."))
    })

    return {
      width: video.videoWidth || null,
      height: video.videoHeight || null,
      durationSec: Number.isFinite(video.duration) ? video.duration : null,
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export default function ProjectCreate() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<PendingFile[]>([])
  const [paths, setPaths] = useState<string[]>([""])
  const [showAdvancedPaths, setShowAdvancedPaths] = useState(false)
  const [classes, setClasses] = useState<string[]>(["person"])
  const [classInput, setClassInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addPath = () => setPaths((prev) => [...prev, ""])
  const removePath = (i: number) => setPaths((prev) => prev.filter((_, j) => j !== i))
  const updatePath = (i: number, val: string) =>
    setPaths((prev) => prev.map((p, j) => (j === i ? val : p)))

  const validPaths = paths.filter((p) => p.trim().length > 0)

  const addClass = () => {
    const t = classInput.trim()
    if (!t || classes.includes(t)) return
    setClasses((prev) => [...prev, t])
    setClassInput("")
  }

  const addFiles = async (files: FileList | File[]) => {
    const incoming = Array.from(files).filter((file) =>
      [".mp4", ".avi", ".mov", ".mkv"].some((suffix) => file.name.toLowerCase().endsWith(suffix)),
    )
    if (incoming.length === 0) {
      setError("지원되는 비디오 파일을 선택하세요. (.mp4, .avi, .mov, .mkv)")
      return
    }

    setError(null)
    const nextItems = await Promise.all(
      incoming.map(async (file) => {
        const meta = await readVideoMeta(file).catch(() => ({
          width: null,
          height: null,
          durationSec: null,
        }))
        return {
          id: `${file.name}-${file.size}-${file.lastModified}`,
          file,
          ...meta,
        }
      }),
    )

    setSelectedFiles((prev) => {
      const knownIds = new Set(prev.map((item) => item.id))
      return [...prev, ...nextItems.filter((item) => !knownIds.has(item.id))]
    })
  }

  const removeFile = (id: string) => {
    setSelectedFiles((prev) => prev.filter((item) => item.id !== id))
  }

  const handleSubmit = async () => {
    if (!name.trim() || (selectedFiles.length === 0 && validPaths.length === 0)) return

    setSubmitting(true)
    setError(null)
    try {
      const project = await api.post<{ id: number }>("/projects", {
        name: name.trim(),
        classes,
      })

      const createdVideos: UploadedVideo[] = []

      for (const pending of selectedFiles) {
        const form = new FormData()
        form.append("file", pending.file)
        form.append("camera_id", "default")
        const created = await api.postForm<UploadedVideo>(`/projects/${project.id}/videos/upload`, form)
        createdVideos.push(created)
      }

      for (const path of validPaths) {
        const created = await api.post<UploadedVideo>(`/projects/${project.id}/videos`, {
          file_path: path.trim(),
          camera_id: "default",
        })
        createdVideos.push(created)
      }

      const firstVideoId = createdVideos[0]?.id
      if (firstVideoId != null) {
        navigate(`/projects/${project.id}/videos/${firstVideoId}`)
      } else {
        navigate("/")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "프로젝트 생성 실패")
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = name.trim().length > 0 && (selectedFiles.length > 0 || validPaths.length > 0) && !submitting

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <button
          onClick={() => navigate("/")}
          className="text-primary hover:text-primary/80 transition-colors"
          title="프로젝트 목록"
        >
          <Logo className="w-5 h-5" />
        </button>
        <button
          onClick={() => navigate("/")}
          className="text-muted-foreground hover:text-foreground transition-colors text-sm"
        >
          ← Projects
        </button>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-lg font-semibold">새 프로젝트</h1>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto py-8 px-6 flex flex-col gap-6">
          {error && (
            <div className="rounded-md bg-destructive/10 text-destructive text-sm px-4 py-3">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">프로젝트 이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="프로젝트 이름 입력"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <label className="text-sm font-medium">비디오 파일</label>
                <p className="text-xs text-muted-foreground mt-1">
                  파일을 선택하거나 여기로 드롭하세요. 업로드 후 바로 첫 비디오 작업 화면으로 이동합니다.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.avi,.mov,.mkv,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files)
                  e.currentTarget.value = ""
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2 rounded-md border border-border text-sm hover:bg-accent transition-colors"
              >
                파일 선택
              </button>
            </div>

            <div
              onDragEnter={(e) => { e.preventDefault(); setDragActive(true) }}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
              onDragLeave={(e) => {
                e.preventDefault()
                if (e.currentTarget === e.target) setDragActive(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragActive(false)
                void addFiles(e.dataTransfer.files)
              }}
              className={`rounded-lg border border-dashed px-5 py-8 text-center transition-colors ${
                dragActive ? "border-primary bg-primary/5" : "border-border bg-card/40"
              }`}
            >
              <p className="text-sm font-medium">파일을 여기에 드롭</p>
              <p className="text-xs text-muted-foreground mt-1">지원 형식: .mp4 .avi .mov .mkv</p>
            </div>

            {selectedFiles.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground">
                  선택한 비디오 {selectedFiles.length}개
                </div>
                <div className="divide-y divide-border">
                  {selectedFiles.map((item) => (
                    <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{item.file.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatBytes(item.file.size)}
                          {item.width && item.height ? ` · ${item.width}×${item.height}` : ""}
                          {item.durationSec != null ? ` · ${item.durationSec.toFixed(1)}초` : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => removeFile(item.id)}
                        className="px-2 text-muted-foreground hover:text-destructive"
                        title="파일 제거"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-md border border-border/70">
              <button
                onClick={() => setShowAdvancedPaths((prev) => !prev)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-accent/40 transition-colors"
              >
                <span>고급: 서버 경로 직접 입력</span>
                <span className="text-muted-foreground">{showAdvancedPaths ? "▴" : "▾"}</span>
              </button>

              {showAdvancedPaths && (
                <div className="border-t border-border px-4 py-4 flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">
                    서버에서 이미 접근 가능한 비디오 경로가 있다면 절대 경로로 직접 등록할 수 있습니다.
                  </p>
                  {paths.map((p, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        value={p}
                        onChange={(e) => updatePath(i, e.target.value)}
                        placeholder="/home/user/videos/clip.mp4"
                        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      {paths.length > 1 && (
                        <button
                          onClick={() => removePath(i)}
                          className="px-2 text-muted-foreground hover:text-destructive"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={addPath}
                    className="self-start text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded px-3 py-1.5 transition-colors"
                  >
                    + 경로 추가
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">클래스 (선택)</label>
            <div className="flex flex-wrap gap-2">
              {classes.map((cls) => (
                <span
                  key={cls}
                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent text-accent-foreground text-xs"
                >
                  {cls}
                  <button onClick={() => setClasses((prev) => prev.filter((c) => c !== cls))} className="hover:text-destructive">×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={classInput}
                onChange={(e) => setClassInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addClass()}
                placeholder="클래스 추가 (ex: person)"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button onClick={addClass} className="px-3 py-2 rounded-md border border-border text-sm hover:bg-accent transition-colors">+ 추가</button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => navigate("/")} className="px-4 py-2 rounded-md border border-border text-sm hover:bg-accent transition-colors">
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "프로젝트 생성 중…" : "프로젝트 생성"}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
