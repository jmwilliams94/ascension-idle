import { create } from 'zustand'
import type { OfflineProgressResult } from './offlineProgress'

interface OfflineProgressState {
  // Null means nothing to show — OfflineProgressModal renders nothing in that
  // case, so it's safe to mount unconditionally in GameShell.
  result: OfflineProgressResult | null
  show: (result: OfflineProgressResult) => void
  dismiss: () => void
}

export const useOfflineProgressStore = create<OfflineProgressState>((set) => ({
  result: null,
  show: (result) => set({ result }),
  dismiss: () => set({ result: null }),
}))
