import { create } from 'zustand'

// Generic "that's VIP-only" notice (2026-09-02) — mirrors
// useHuntingTakeoverToastStore.ts's exact shape (nullable single-value field,
// caller setTimeout auto-clear). First fired by the Inventory potion row's
// Auto button when a non-VIP account clicks it; reusable by any other
// VIP-gated control that wants a toast instead of (or in addition to) a
// disabled-button title tooltip.
interface RequiresVipToastState {
  message: string | null
  show: (message?: string) => void
  dismiss: () => void
}

export const useRequiresVipToastStore = create<RequiresVipToastState>((set) => ({
  message: null,
  show: (message = 'Requires VIP') => set({ message }),
  dismiss: () => set({ message: null }),
}))
