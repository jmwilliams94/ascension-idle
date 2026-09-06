import { create } from 'zustand'

interface DailyQuestsModalState {
  open: boolean
  openModal: () => void
  closeModal: () => void
}

export const useDailyQuestsModalStore = create<DailyQuestsModalState>((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
}))
