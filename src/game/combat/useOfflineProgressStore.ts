import { create } from 'zustand'
import type { OfflineProgressResult } from './offlineProgress'
import type { OfflineMiningProgressResult } from '../mining/offlineMiningProgress'

interface OfflineProgressState {
  // Null means nothing to show — OfflineProgressModal renders nothing in that
  // case, so it's safe to mount unconditionally in GameShell. Hunting and
  // Mining can never both accrue offline progress, so result/miningResult
  // are mutually exclusive in practice — show()/showMining() each clear the
  // other defensively anyway.
  result: OfflineProgressResult | null
  // Mining's own "welcome back" result (added alongside the VIP automation
  // work — previously Mining had no summary modal at all, a known v1 gap;
  // see runOfflineMiningProgressCheck's own history).
  miningResult: OfflineMiningProgressResult | null
  // True when a check came back as a genuine failure (runOfflineProgressCheck's
  // 'error' outcome) rather than "nothing happened" -- the modal shows an
  // explicit "couldn't sync" state instead of silently vanishing (2026-08-15,
  // reported by the user: "Calculating Rewards pop up and then nothing" -- the
  // same class of bug as the level-130 permission fix, just a swallowed-failure
  // UI gap instead of a DB grant). Nothing is actually lost when this fires --
  // the away-window is simply retried on the next resolve, same as always.
  syncFailed: boolean
  show: (result: OfflineProgressResult) => void
  showMining: (result: OfflineMiningProgressResult) => void
  showSyncFailed: () => void
  dismiss: () => void
}

export const useOfflineProgressStore = create<OfflineProgressState>((set) => ({
  result: null,
  miningResult: null,
  syncFailed: false,
  show: (result) => set({ result, miningResult: null, syncFailed: false }),
  showMining: (result) => set({ miningResult: result, result: null, syncFailed: false }),
  showSyncFailed: () => set({ syncFailed: true }),
  dismiss: () => set({ result: null, miningResult: null, syncFailed: false }),
}))
