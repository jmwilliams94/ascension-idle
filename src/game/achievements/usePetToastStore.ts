import { create } from 'zustand'

// Live-mode-only pet-obtained celebration toast (2026-08-03, confirmed with
// the user) — separate from useCombatStore.logPetObtained (the combat-log
// line, unchanged, still fires for both live and offline). Offline-mode pet
// grants get their own dedicated callout in OfflineProgressModal instead of
// this toast (see useOfflineProgressStore/OfflineProgressResult.petObtained)
// — there's no live page open to show a transient toast on while away.
// Mirrors useOfflineProgressStore.ts's exact shape.
interface PetToastState {
  monsterName: string | null
  show: (monsterName: string) => void
  dismiss: () => void
}

export const usePetToastStore = create<PetToastState>((set) => ({
  monsterName: null,
  show: (monsterName) => set({ monsterName }),
  dismiss: () => set({ monsterName: null }),
}))
