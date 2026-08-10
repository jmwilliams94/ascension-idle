import { create } from 'zustand'

// Drives FireworkTestOverlay — a Settings-only "preview" button (Item
// Effects section) that fires a full-screen burst of the same confetti-style
// embers used by MoneyBagRevealModal/SalvageRevealToast (buildConfettiEmbers/
// .effect-ember-confetti), just scattered across the whole viewport and using
// every established ember color at once instead of one reveal's own color.
// Dev/QA-facing only — nothing else in the game triggers this.
//
// `burstId` (not just a boolean) so re-clicking Test mid-animation still
// remounts a fresh burst (React key change) instead of no-opping because
// `active` was already true.
interface FireworkTestState {
  burstId: number | null
  fire: () => void
  dismiss: () => void
}

let nextBurstId = 0

export const useFireworkTestStore = create<FireworkTestState>((set) => ({
  burstId: null,
  fire: () => set({ burstId: nextBurstId++ }),
  dismiss: () => set({ burstId: null }),
}))
