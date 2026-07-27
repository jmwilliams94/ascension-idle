import { create } from 'zustand'

// Whether the Shop overlay is showing. Separate from useHudTabStore's tab selection
// deliberately — the Shop is an overlay that replaces the bottom nav in place
// (closable via an X), not another tab the sidebar also switches to.
interface ShopState {
  isOpen: boolean
  open: () => void
  close: () => void
}

export const useShopStore = create<ShopState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}))
