/**
 * Zustand store — AI worker job state.
 */
import { create } from "zustand"

interface WorkerState {
  activeJobId: number | null
  progress: number
  status: string | null
  setJob: (jobId: number) => void
  updateProgress: (progress: number, status: string) => void
  clearJob: () => void
}

export const useWorkerStore = create<WorkerState>((set) => ({
  activeJobId: null,
  progress: 0,
  status: null,
  setJob: (jobId) => set({ activeJobId: jobId, progress: 0, status: "pending" }),
  updateProgress: (progress, status) => set({ progress, status }),
  clearJob: () => set({ activeJobId: null, progress: 0, status: null }),
}))
