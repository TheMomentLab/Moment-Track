/**
 * Zustand store — video playback state.
 */
import { create } from "zustand"

interface VideoState {
  currentFrame: number
  totalFrames: number
  fps: number
  isPlaying: boolean
  playbackRate: number
  setFrame: (frame: number) => void
  setVideoMeta: (totalFrames: number, fps: number) => void
  setPlaying: (playing: boolean) => void
  setPlaybackRate: (rate: number) => void
}

export const useVideoStore = create<VideoState>((set) => ({
  currentFrame: 0,
  totalFrames: 0,
  fps: 30,
  isPlaying: false,
  playbackRate: 1,
  setFrame: (frame) => set({ currentFrame: frame }),
  setVideoMeta: (totalFrames, fps) => set({ totalFrames, fps }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setPlaybackRate: (rate) => set({ playbackRate: rate }),
}))
