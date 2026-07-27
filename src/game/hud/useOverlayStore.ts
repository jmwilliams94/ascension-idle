import { create } from 'zustand'

// Which panel (if any) is currently showing as an overlay on top of GameCanvas —
// Zone/Equipment/Forge/Marketplace/Shop all live here now (see BottomNav), not as
// sidebar tabs. Only one can be open at a time; opening a new one replaces whatever
// was open. Replaces the old separate useShopStore + useHudTabStore split.
export type OverlayId = 'shop' | 'zone' | 'equipment' | 'forge' | 'marketplace'

interface OverlayState {
  activeOverlay: OverlayId | null
  open: (overlay: OverlayId) => void
  close: () => void
}

export const useOverlayStore = create<OverlayState>((set) => ({
  activeOverlay: null,
  open: (overlay) => set({ activeOverlay: overlay }),
  close: () => set({ activeOverlay: null }),
}))
