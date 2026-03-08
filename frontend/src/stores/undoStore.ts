import { create } from "zustand"

const HISTORY_LIMIT = 20

export interface Command {
  undo: () => Promise<void>
  redo: () => Promise<void>
  description: string
}

interface UndoState {
  undoStack: Command[]
  redoStack: Command[]
  push: (cmd: Command) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: boolean
  canRedo: boolean
}

export const useUndoStore = create<UndoState>((set, get) => ({
  undoStack: [],
  redoStack: [],
  canUndo: false,
  canRedo: false,
  push: (cmd) => {
    const nextUndo = [...get().undoStack, cmd]
    const trimmedUndo =
      nextUndo.length > HISTORY_LIMIT
        ? nextUndo.slice(nextUndo.length - HISTORY_LIMIT)
        : nextUndo
    set({
      undoStack: trimmedUndo,
      redoStack: [],
      canUndo: trimmedUndo.length > 0,
      canRedo: false,
    })
  },
  undo: async () => {
    const { undoStack, redoStack } = get()
    if (undoStack.length === 0) return
    const cmd = undoStack[undoStack.length - 1]
    await cmd.undo()
    const nextUndo = undoStack.slice(0, -1)
    const nextRedo = [...redoStack, cmd]
    set({
      undoStack: nextUndo,
      redoStack: nextRedo,
      canUndo: nextUndo.length > 0,
      canRedo: nextRedo.length > 0,
    })
  },
  redo: async () => {
    const { undoStack, redoStack } = get()
    if (redoStack.length === 0) return
    const cmd = redoStack[redoStack.length - 1]
    await cmd.redo()
    const nextRedo = redoStack.slice(0, -1)
    const nextUndo = [...undoStack, cmd]
    const trimmedUndo =
      nextUndo.length > HISTORY_LIMIT
        ? nextUndo.slice(nextUndo.length - HISTORY_LIMIT)
        : nextUndo
    set({
      undoStack: trimmedUndo,
      redoStack: nextRedo,
      canUndo: trimmedUndo.length > 0,
      canRedo: nextRedo.length > 0,
    })
  },
}))
