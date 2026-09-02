import { create } from 'zustand'

// Backs UpdateBanner.tsx — wired up from main.tsx's registerSW call
// (registerType: 'prompt', see vite.config.ts) instead of the old silent
// autoUpdate flow. needRefresh flips true once a new service worker has
// finished installing and is waiting to take over; applyUpdate calls the
// registration's own updateSW(true), which posts a SKIP_WAITING message to
// the waiting worker and reloads once it becomes the controller.
//
// Fallback (2026-08-10, reported by a user on Firefox: clicking Refresh did
// nothing) — workbox-window's messageSkipWaiting() is a documented silent
// no-op if there's no `registration.waiting` worker at that exact instant
// (a real cross-browser race, apparently hit more often on Firefox): "If
// there is no current registration or no service worker is waiting, calling
// this will have no effect." When that happens, nothing ever reloads the
// page and the button looks broken. FALLBACK_MS below gives the normal path
// a window to reload the page itself (which tears down this timeout); if
// that hasn't happened, force it — unregistering every service worker first
// (not a bare reload) matters: the *old* worker is still the active
// controller and would otherwise keep serving its own cached shell/assets
// straight from precache, so a plain reload alone could look like it did
// nothing even though the page technically reloaded. Unregistering is safe
// — no game state lives in the service worker, and main.tsx re-registers a
// fresh one on the next load regardless.
const REFRESH_FALLBACK_MS = 2500

async function forceCleanReload() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  } catch (error) {
    console.error('Failed to unregister stale service worker(s) during forced update', error)
  }
  window.location.reload()
}

interface AppUpdateState {
  needRefresh: boolean
  // True from the moment Refresh is clicked until the page actually
  // reloads — lets UpdateBanner show "Refreshing…" instead of looking inert
  // during whatever gap exists before the page navigates away.
  refreshing: boolean
  updateSW: ((reloadPage?: boolean) => Promise<void>) | null
  // Set once by main.tsx's onRegisteredSW (2026-09-02) — lets
  // staleClientFetch.ts force an out-of-cycle registration.update() check
  // the instant a request looks like a stale-client schema mismatch,
  // instead of only ever finding out up to UPDATE_CHECK_INTERVAL_MS late.
  registration: ServiceWorkerRegistration | null
  setNeedRefresh: (needRefresh: boolean) => void
  setUpdateSW: (updateSW: (reloadPage?: boolean) => Promise<void>) => void
  setRegistration: (registration: ServiceWorkerRegistration) => void
  applyUpdate: () => void
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  needRefresh: false,
  refreshing: false,
  updateSW: null,
  registration: null,
  setNeedRefresh: (needRefresh) => set({ needRefresh }),
  setUpdateSW: (updateSW) => set({ updateSW }),
  setRegistration: (registration) => set({ registration }),
  applyUpdate: () => {
    set({ refreshing: true })
    void get().updateSW?.(true)
    setTimeout(() => void forceCleanReload(), REFRESH_FALLBACK_MS)
  },
}))
