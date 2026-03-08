/**
 * Zustand store — project state.
 */
import { create } from "zustand"

interface ProjectState {
  currentProjectId: number | null
  projectName: string
  classes: string[]
  setProject: (id: number, name: string, classes: string[]) => void
  clear: () => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProjectId: null,
  projectName: "",
  classes: [],
  setProject: (id, name, classes) =>
    set({ currentProjectId: id, projectName: name, classes }),
  clear: () =>
    set({ currentProjectId: null, projectName: "", classes: [] }),
}))
