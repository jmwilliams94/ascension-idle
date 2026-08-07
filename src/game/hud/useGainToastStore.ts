import { create } from 'zustand'

// Floating "+N gained" toast (2026-08-07, confirmed with the user) — fired
// for deliberate player actions (Bank deposit/withdraw, Forge Salvage, Shop
// sell) so a gain is visibly confirmed right where the player is looking,
// not just reflected in a number somewhere else on the page. Deliberately
// NOT fired from live combat's own per-kill gold/EXP predictive ticks (see
// useCombatStore.runTick/useProgressionStore) — those already have the
// combat log + EXP bar, and firing a toast on every kill during idle
// fighting would be pure spam (confirmed with the user). A stack, not a
// single slot (unlike usePetToastStore's one-off celebration banner), since
// a bulk action (Sell Selected, Salvage Selected) can produce several gains
// in the same instant.
export interface GainToastEntry {
  id: string
  label: string
  amount: number
  icon?: string
  iconSrc?: string
  color?: string
}

interface GainToastState {
  toasts: GainToastEntry[]
  show: (entry: Omit<GainToastEntry, 'id'>) => void
  dismiss: (id: string) => void
}

let nextToastId = 0

export const useGainToastStore = create<GainToastState>((set) => ({
  toasts: [],
  show: (entry) => {
    const id = `gain-toast-${Date.now()}-${nextToastId++}`
    set((state) => ({ toasts: [...state.toasts, { ...entry, id }] }))
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
