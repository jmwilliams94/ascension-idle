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
  // Opens the given overlay, or closes it if it's already the one showing — lets
  // BottomNav's buttons act as an on/off toggle instead of only ever opening.
  toggle: (overlay: OverlayId) => void
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  activeOverlay: null,
  open: (overlay) => set({ activeOverlay: overlay }),
  close: () => set({ activeOverlay: null }),
  toggle: (overlay) => set({ activeOverlay: get().activeOverlay === overlay ? null : overlay }),
}))
