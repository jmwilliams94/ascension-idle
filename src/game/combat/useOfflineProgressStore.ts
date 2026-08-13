import { create } from 'zustand'
import type { OfflineProgressResult } from './offlineProgress'

interface OfflineProgressState {
  // Null means nothing to show — OfflineProgressModal renders nothing in that
  // case, so it's safe to mount unconditionally in GameShell.
  result: OfflineProgressResult | null
  // True while a resolveCombat('offline') round trip is in flight (set by
  // GameShell right before calling runOfflineProgressCheck) — lets the modal
  // show a "Calculating your rewards…" state instead of sitting blank for
  // however long the network/Edge Function call takes, which previously read
  // as an inconsistent delay with no feedback either way.
  checking: boolean
  show: (result: OfflineProgressResult) => void
  dismiss: () => void
  setChecking: (checking: boolean) => void
}

export const useOfflineProgressStore = create<OfflineProgressState>((set) => ({
  result: null,
  checking: false,
  show: (result) => set({ result, checking: false }),
  dismiss: () => set({ result: null }),
  setChecking: (checking) => set({ checking }),
}))
