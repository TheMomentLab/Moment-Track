/**
 * CropGallery — Identity별 detection crop 썸네일 브라우저.
 *
 * 레이아웃: 좌측 Identity 목록 | 우측 CropGrid
 * 라우트: /projects/:projectId/gallery
 */
import { useState, useEffect, useCallback, useMemo } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { api } from "@/api/client"
import { toast } from "sonner"
import CropGrid from "@/components/CropGrid"
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
import type { Identity } from "@/types"

interface CropItem {
  detection_id: number
  video_id: number
  frame_idx: number
  track_id: number | null
  bbox: { x: number; y: number; w: number; h: number }
  anomaly_score?: number | null
}

const PALETTE = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
  "#06b6d4", "#a855f7", "#84cc16", "#fb923c",
]
function trackColor(id: number): string {
  return PALETTE[Math.abs(id) % PALETTE.length]
}

export default function CropGallery() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const pid = Number(projectId)

  const [identities, setIdentities] = useState<Identity[]>([])
  const [selectedIdentityId, setSelectedIdentityId] = useState<number | null>(null)
  const [crops, setCrops] = useState<CropItem[]>([])
  const [selectedDetectionId, setSelectedDetectionId] = useState<number | null>(null)
  const [loadingIdentities, setLoadingIdentities] = useState(true)
  const [loadingCrops, setLoadingCrops] = useState(false)

  // filter state (persisted to localStorage)
  const [keyframesOnly, setKeyframesOnly] = useState(() => localStorage.getItem("mt_cropGallery_keyframesOnly") === "true")
  const [stride, setStride] = useState(() => {
    const saved = localStorage.getItem("mt_cropGallery_stride")
    return saved ? Math.max(1, Number(saved)) : 5
  })
  const [cols, setCols] = useState(() => {
    const saved = localStorage.getItem("mt_cropGallery_cols")
    return saved ? Number(saved) : 4
  })
  const [classFilter, setClassFilter] = useState("all")
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSelected, setMergeSelected] = useState<Set<number>>(new Set())
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem("mt_cropGallery_keyframesOnly", String(keyframesOnly))
  }, [keyframesOnly])
  useEffect(() => {
    localStorage.setItem("mt_cropGallery_stride", String(stride))
  }, [stride])
  useEffect(() => {
    localStorage.setItem("mt_cropGallery_cols", String(cols))
  }, [cols])

  const loadIdentities = useCallback(async () => {
    setLoadingIdentities(true)
    try {
      const r = await api.get<{ items: Identity[] }>(`/projects/${pid}/identities?limit=200`)
      setIdentities(r.items)
      if (r.items.length > 0) setSelectedIdentityId(r.items[0].id)
      else setSelectedIdentityId(null)
    } catch {
    } finally {
      setLoadingIdentities(false)
    }
  }, [pid])

  useEffect(() => {
    loadIdentities()
  }, [loadIdentities])

  // load crops for selected identity
  const loadCrops = useCallback(() => {
    if (selectedIdentityId === null) { setCrops([]); return }
    setLoadingCrops(true)
    api
      .get<{ items: CropItem[] }>(
        `/identities/${selectedIdentityId}/crops?stride=${stride}&keyframes_only=${keyframesOnly}&limit=500`,
      )
      .then((r) => setCrops(r.items))
      .catch(() => setCrops([]))
      .finally(() => setLoadingCrops(false))
  }, [selectedIdentityId, stride, keyframesOnly])

  useEffect(() => { loadCrops() }, [loadCrops])

  const classOptions = useMemo(
    () => Array.from(new Set(identities.map((identity) => identity.class_name))).sort(),
    [identities],
  )

  const filteredIdentities = useMemo(
    () => (classFilter === "all"
      ? identities
      : identities.filter((identity) => identity.class_name === classFilter)),
    [identities, classFilter],
  )

  useEffect(() => {
    if (filteredIdentities.length === 0) {
      setSelectedIdentityId(null)
      return
    }
    if (!filteredIdentities.some((identity) => identity.id === selectedIdentityId)) {
      setSelectedIdentityId(filteredIdentities[0].id)
      setSelectedDetectionId(null)
    }
  }, [filteredIdentities, selectedIdentityId])

  const selectedIdentity = filteredIdentities.find((i) => i.id === selectedIdentityId)

  const toggleMergeMode = useCallback(() => {
    setMergeMode((prev) => !prev)
    setMergeSelected(new Set())
  }, [])

  const toggleMergeSelected = useCallback((identityId: number, checked: boolean) => {
    setMergeSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(identityId)
      else next.delete(identityId)
      return next
    })
  }, [])

  const handleCropSelect = useCallback((detectionId: number | null) => {
    setSelectedDetectionId(detectionId)
    if (detectionId === null) return
    const item = crops.find((crop) => crop.detection_id === detectionId)
    if (!item) return
    navigate(`/projects/${pid}/videos/${item.video_id}?frame=${item.frame_idx}`)
  }, [crops, navigate, pid])

  const handleMergeConfirm = useCallback(async () => {
    const selectedIds = Array.from(mergeSelected)
    if (selectedIds.length < 2) return
    const keepId = selectedIds[0]
    const mergeId = selectedIds[1]
    try {
      await api.post<{ keep: Identity; deleted_id: number; tracks_moved: number }>("/identities/merge", {
        keep_id: keepId,
        merge_id: mergeId,
      })
      await loadIdentities()
      setMergeMode(false)
      setMergeSelected(new Set())
      setSelectedDetectionId(null)
      toast.success("Identity 병합 완료")
    } catch {
      toast.error("Identity 병합 실패")
    } finally {
      setMergeConfirmOpen(false)
    }
  }, [mergeSelected, loadIdentities])

  const mergeIds = Array.from(mergeSelected)

  return (
    <>
    <AlertDialog open={mergeConfirmOpen} onOpenChange={setMergeConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Identity 병합</AlertDialogTitle>
          <AlertDialogDescription>
            {mergeIds.length >= 2
              ? `Identity #${mergeIds[1]}의 모든 트랙이 Identity #${mergeIds[0]}로 이동됩니다. 계속하시겠습니까?`
              : "병합할 Identity를 2개 선택하세요."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={() => void handleMergeConfirm()}>확인</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* TopBar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border text-sm flex-shrink-0 bg-card">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="text-primary hover:text-primary/80 transition-colors"
            title="프로젝트 목록"
          >
            <Logo className="w-5 h-5" />
          </button>
          <span className="font-semibold">Crop Gallery</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground text-xs">Project #{pid}</span>
        </div>

        {/* Filter controls */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-1">
            클래스
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="bg-background border border-border rounded px-1 py-0.5 text-foreground text-xs"
            >
              <option value="all">All</option>
              {classOptions.map((className) => (
                <option key={className} value={className}>{className}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={keyframesOnly}
              onChange={(e) => setKeyframesOnly(e.target.checked)}
              className="accent-primary"
            />
            키프레임만
          </label>
          <label className="flex items-center gap-1">
            Stride
            <input
              type="number"
              value={stride}
              min={1}
              max={100}
              onChange={(e) => setStride(Math.max(1, Number(e.target.value)))}
              className="w-12 text-center bg-background border border-border rounded px-1 py-0.5 text-foreground text-xs"
            />
          </label>
          <label className="flex items-center gap-1">
            열
            <select
              value={cols}
              onChange={(e) => setCols(Number(e.target.value))}
              className="bg-background border border-border rounded px-1 py-0.5 text-foreground text-xs"
            >
              {[2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {/* Main: identity list | crop grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Identity sidebar */}
        <aside className="w-52 flex-shrink-0 border-r border-border flex flex-col overflow-hidden bg-card">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Identities ({filteredIdentities.length})
            </span>
            <button
              onClick={toggleMergeMode}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                mergeMode
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Merge Mode
            </button>
          </div>
          {mergeMode && mergeSelected.size >= 2 && (
            <div className="px-3 py-2 border-b border-border">
              <button
                onClick={() => setMergeConfirmOpen(true)}
                className="w-full text-xs py-1.5 rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Merge
              </button>
            </div>
          )}
          <div className="flex-1 overflow-auto">
            {loadingIdentities && (
              <p className="text-xs text-muted-foreground p-3 text-center">로딩 중…</p>
            )}
            {!loadingIdentities && filteredIdentities.length === 0 && (
              <p className="text-xs text-muted-foreground p-4 text-center leading-relaxed">
                Identity가 없습니다.<br />
                어노테이터에서 먼저 생성하세요.
              </p>
            )}
            {filteredIdentities.map((identity) => {
              const isSelected = identity.id === selectedIdentityId
              const checked = mergeSelected.has(identity.id)
              return (
                <div
                  key={identity.id}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-accent ${
                    isSelected ? "bg-accent font-medium" : ""
                  }`}
                >
                  {mergeMode && (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleMergeSelected(identity.id, e.target.checked)}
                      className="accent-primary"
                    />
                  )}
                  <button
                    onClick={() => { setSelectedIdentityId(identity.id); setSelectedDetectionId(null) }}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: trackColor(identity.id) }}
                    />
                    <span className="flex-1 truncate">
                      {identity.label ?? `Identity #${identity.id}`}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {identity.track_count}t
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </aside>

        {/* Crop grid area */}
        <main className="flex-1 overflow-auto">
          {/* Identity header */}
          {selectedIdentity && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border text-xs text-muted-foreground bg-card/50">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: trackColor(selectedIdentity.id) }}
              />
              <span className="font-medium text-foreground">
                {selectedIdentity.label ?? `Identity #${selectedIdentity.id}`}
              </span>
              <span>·</span>
              <span>{selectedIdentity.class_name}</span>
              <span>·</span>
              <span>{crops.length} crops</span>
              {selectedDetectionId !== null && (
                <>
                  <span>·</span>
                  <span className="text-primary">Det #{selectedDetectionId} 선택됨</span>
                  <button
                    onClick={() => setSelectedDetectionId(null)}
                    className="text-muted-foreground hover:text-foreground ml-1"
                  >×</button>
                </>
              )}
            </div>
          )}

          {loadingCrops ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              로딩 중…
            </div>
          ) : (
            <CropGrid
              items={crops}
              selectedDetectionId={selectedDetectionId}
              onSelect={handleCropSelect}
              cols={cols}
            />
          )}
        </main>
      </div>
    </div>
    </>
  )
}
