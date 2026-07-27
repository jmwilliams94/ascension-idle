import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DisplaySettingsState {
  showMonsterNames: boolean
  showMonsterHealth: boolean
  setShowMonsterNames: (value: boolean) => void
  setShowMonsterHealth: (value: boolean) => void
}

export const useDisplaySettingsStore = create<DisplaySettingsState>()(
  persist(
    (set) => ({
      showMonsterNames: true,
      showMonsterHealth: true,
      setShowMonsterNames: (value) => set({ showMonsterNames: value }),
      setShowMonsterHealth: (value) => set({ showMonsterHealth: value }),
    }),
    { name: 'greybox-display-settings' },
  ),
)
