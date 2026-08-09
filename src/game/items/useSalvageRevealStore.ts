import { create } from 'zustand'

// Drives SalvageRevealToast — a center-screen "+N Ascension Points" reveal
// for a Salvage result (2026-08-13, requested by the user). Salvage gains
// previously used the generic top-right GainToastHost stack (see
// SalvagePanel.tsx); moved to a dedicated center reveal, similar in spirit
// to MoneyBagRevealModal's own reveal moment, since a Salvage result gets
// its own visual weight now. A unique id per show() (not just the amount)
// so two same-amount salvages in a row still get their own animation
// instance even if the previous reveal hasn't fully dismissed yet.
export interface SalvageReveal {
  id: string
  amount: number
}

interface SalvageRevealState {
  reveal: SalvageReveal | null
  show: (amount: number) => void
  dismiss: () => void
}

let nextRevealId = 0

export const useSalvageRevealStore = create<SalvageRevealState>((set) => ({
  reveal: null,
  show: (amount) => set({ reveal: { id: `salvage-reveal-${Date.now()}-${nextRevealId++}`, amount } }),
  dismiss: () => set({ reveal: null }),
}))
