import { create } from 'zustand'

// PvP damage toast queue — a small slide-in/out chip whenever either side's
// HP drops, white if the active character dealt it, red if they took it
// (requested by the user after playtesting). Populated from
// usePvpDuelStore.setDuel's own before/after HP diff (the single choke
// point every duel update passes through, whether from this client's own
// action or the realtime echo of it) rather than a separate detection path
// in the UI — same "server/store is the source of truth" convention as the
// rest of this feature.

export interface PvpDamageToastEntry {
  id: string
  amount: number
  dealt: boolean
}

interface PvpDamageToastState {
  toasts: PvpDamageToastEntry[]
  show: (amount: number, dealt: boolean) => void
  dismiss: (id: string) => void
  clear: () => void
}

let nextToastId = 0

export const usePvpDamageToastStore = create<PvpDamageToastState>((set) => ({
  toasts: [],
  show: (amount, dealt) =>
    set((state) => ({
      toasts: [...state.toasts, { id: `pvp-dmg-${nextToastId++}`, amount, dealt }],
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))
