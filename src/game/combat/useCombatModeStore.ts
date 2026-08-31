import { create } from 'zustand'

// Which in-page sub-mode of the Combat tab is currently visible — Hunting /
// Mining / Events (see CombatPage.tsx's own CombatMode type). Lifted out of
// CombatPage's local useState (2026-08-29) so KillRewardToast can gate on it
// without prop-drilling: the kill-reward toast should only pop while the
// player is actually looking at the Hunting view, not from every tab.
export type CombatViewMode = 'hunting' | 'mining' | 'events' | 'pvp'

interface CombatModeState {
  mode: CombatViewMode
  setMode: (mode: CombatViewMode) => void
}

export const useCombatModeStore = create<CombatModeState>((set) => ({
  mode: 'hunting',
  setMode: (mode) => set({ mode }),
}))
