import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/api/client"

export default function ProjectCreate() {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [paths, setPaths] = useState<string[]>([""])
  const [classes, setClasses] = useState<string[]>(["person"])
  const [classInput, setClassInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
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

  const handleSubmit = async () => {
    if (!name.trim() || validPaths.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const project = await api.post<{ id: number }>("/projects", {
        name: name.trim(),
        classes,
      })
      for (const path of validPaths) {
        await api.post(`/projects/${project.id}/videos`, {
          file_path: path.trim(),
          camera_id: "default",
        })
      }
      navigate("/")
    } catch (e) {
      setError(e instanceof Error ? e.message : "프로젝트 생성 실패")
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = name.trim().length > 0 && validPaths.length > 0 && !submitting

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <button
          onClick={() => navigate("/")}
          className="text-muted-foreground hover:text-foreground transition-colors text-sm"
        >
          ← Back
        </button>
        <h1 className="text-xl font-bold">새 프로젝트</h1>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="max-w-lg mx-auto py-8 px-6 flex flex-col gap-6">
          {error && (
            <div className="rounded-md bg-destructive/10 text-destructive text-sm px-4 py-3">
              {error}
            </div>
          )}

          {/* 프로젝트명 */}
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

          {/* 비디오 파일 경로 */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">비디오 파일 경로</label>
            <p className="text-xs text-muted-foreground">
              서버에서 접근 가능한 비디오 파일의 절대 경로를 입력하세요.
              <br />
              지원 형식: .mp4 .avi .mov .mkv
            </p>
            <div className="flex flex-col gap-2">
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
                + 비디오 추가
              </button>
            </div>
          </div>

          {/* 클래스 */}
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

          {/* 버튼 */}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => navigate("/")} className="px-4 py-2 rounded-md border border-border text-sm hover:bg-accent transition-colors">
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "생성 중…" : "프로젝트 생성"}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
