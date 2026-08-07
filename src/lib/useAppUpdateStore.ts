import { create } from 'zustand'

// Backs UpdateBanner.tsx — wired up from main.tsx's registerSW call
// (registerType: 'prompt', see vite.config.ts) instead of the old silent
// autoUpdate flow. needRefresh flips true once a new service worker has
// finished installing and is waiting to take over; applyUpdate calls the
// registration's own updateSW(true), which activates it and reloads the page.
interface AppUpdateState {
  needRefresh: boolean
  updateSW: ((reloadPage?: boolean) => Promise<void>) | null
  setNeedRefresh: (needRefresh: boolean) => void
  setUpdateSW: (updateSW: (reloadPage?: boolean) => Promise<void>) => void
  applyUpdate: () => void
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  needRefresh: false,
  updateSW: null,
  setNeedRefresh: (needRefresh) => set({ needRefresh }),
  setUpdateSW: (updateSW) => set({ updateSW }),
  applyUpdate: () => {
    void get().updateSW?.(true)
  },
}))
