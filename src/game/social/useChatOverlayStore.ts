import { create } from 'zustand'

// Explicit open/closed flag for ChatOverlay.tsx, same shape as
// useLootHoldingModalStore -- the overlay itself is mounted unconditionally
// in GameShell and reads this to decide whether to render.
interface ChatOverlayState {
  open: boolean
  openOverlay: () => void
  closeOverlay: () => void
}

export const useChatOverlayStore = create<ChatOverlayState>((set) => ({
  open: false,
  openOverlay: () => set({ open: true }),
  closeOverlay: () => set({ open: false }),
}))
