import { create } from 'zustand'

// Drives FireworkOverlay — a full-screen scatter of the same confetti-style
// embers used by MoneyBagRevealModal/SalvageRevealToast (buildConfettiEmbers/
// .effect-ember-confetti), fired from several random points across the whole
// viewport, cycling through every established ember color at once. Started
// as a Settings-only preview button; now also fires as the celebration for
// successfully gaining a gear socket (see useForgeStore.ts's socket-gain
// checks — both the RNG armor proc and the guaranteed weapon unlock).
//
// `burstId` (not just a boolean) so a new fire() mid-animation still remounts
// a fresh burst (React key change) instead of no-opping because a burst was
// already in progress.
interface FireworkState {
  burstId: number | null
  fire: () => void
  dismiss: () => void
}

let nextBurstId = 0

export const useFireworkStore = create<FireworkState>((set) => ({
  burstId: null,
  fire: () => set({ burstId: nextBurstId++ }),
  dismiss: () => set({ burstId: null }),
}))
