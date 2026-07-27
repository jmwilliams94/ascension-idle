import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DisplaySettingsState {
  showMonsterNames: boolean
  showMonsterHealth: boolean
  showItemDropText: boolean
  setShowMonsterNames: (value: boolean) => void
  setShowMonsterHealth: (value: boolean) => void
  setShowItemDropText: (value: boolean) => void
}

export const useDisplaySettingsStore = create<DisplaySettingsState>()(
  persist(
    (set) => ({
      showMonsterNames: true,
      showMonsterHealth: true,
      showItemDropText: true,
      setShowMonsterNames: (value) => set({ showMonsterNames: value }),
      setShowMonsterHealth: (value) => set({ showMonsterHealth: value }),
      setShowItemDropText: (value) => set({ showItemDropText: value }),
    }),
    { name: 'greybox-display-settings' },
  ),
)
