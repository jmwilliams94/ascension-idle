import { create } from 'zustand'
import type { OfflineProgressResult } from './offlineProgress'

interface OfflineProgressState {
  // Null means nothing to show — OfflineProgressModal renders nothing in that
  // case, so it's safe to mount unconditionally in GameShell.
  result: OfflineProgressResult | null
  // True when a check came back as a genuine failure (runOfflineProgressCheck's
  // 'error' outcome) rather than "nothing happened" -- the modal shows an
  // explicit "couldn't sync" state instead of silently vanishing (2026-08-15,
  // reported by the user: "Calculating Rewards pop up and then nothing" -- the
  // same class of bug as the level-130 permission fix, just a swallowed-failure
  // UI gap instead of a DB grant). Nothing is actually lost when this fires --
  // the away-window is simply retried on the next resolve, same as always.
  syncFailed: boolean
  show: (result: OfflineProgressResult) => void
  showSyncFailed: () => void
  dismiss: () => void
}

export const useOfflineProgressStore = create<OfflineProgressState>((set) => ({
  result: null,
  syncFailed: false,
  show: (result) => set({ result, syncFailed: false }),
  showSyncFailed: () => set({ syncFailed: true }),
  dismiss: () => set({ result: null, syncFailed: false }),
}))
