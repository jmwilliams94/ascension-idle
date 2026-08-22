import { create } from 'zustand'

// Explicit open/closed flag for VipSettingsModal, same shape as
// useLootHoldingModalStore — opened by clicking VipStatusHud's HUD badge.
interface VipSettingsModalState {
  open: boolean
  openModal: () => void
  closeModal: () => void
}

export const useVipSettingsModalStore = create<VipSettingsModalState>((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
}))
