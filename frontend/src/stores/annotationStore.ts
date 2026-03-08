/**
 * Zustand store — annotation state (detections, selected track/identity).
 */
import { create } from "zustand"

interface AnnotationState {
  selectedTrackId: number | null
  selectedIdentityId: number | null
  selectTrack: (id: number | null) => void
  selectIdentity: (id: number | null) => void
}

export const useAnnotationStore = create<AnnotationState>((set) => ({
  selectedTrackId: null,
  selectedIdentityId: null,
  selectTrack: (id) => set({ selectedTrackId: id }),
  selectIdentity: (id) => set({ selectedIdentityId: id }),
}))
