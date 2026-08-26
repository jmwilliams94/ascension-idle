import { create } from 'zustand'

// Hunting Slot takeover celebration/notice toast (2026-10-23) — mirrors
// usePetToastStore.ts's exact shape (nullable single-value field, caller
// setTimeout auto-clear). Fired from CombatPage.tsx's handleFight whenever
// claim_hunting_slot reports a *different* character got displaced, so the
// player understands why their other character just stopped Hunting instead
// of it looking like a silent bug.
interface HuntingTakeoverToastState {
  displacedCharacterName: string | null
  show: (displacedCharacterName: string) => void
  dismiss: () => void
}

export const useHuntingTakeoverToastStore = create<HuntingTakeoverToastState>((set) => ({
  displacedCharacterName: null,
  show: (displacedCharacterName) => set({ displacedCharacterName }),
  dismiss: () => set({ displacedCharacterName: null }),
}))
