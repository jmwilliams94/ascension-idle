import { useAppUpdateStore } from '../lib/useAppUpdateStore'

// Fixed top banner shown once a new build has installed in the background
// and is waiting to take over (see main.tsx's registerSW/onNeedRefresh wiring
// and vite.config.ts's registerType: 'prompt'). Rendered at the App root so
// it's visible regardless of auth/character-select state. No dismiss button —
// the new service worker is already installed and waiting, so there's
// nothing to opt out of, only defer (closing the tab still applies it next launch).
export default function UpdateBanner() {
  const needRefresh = useAppUpdateStore((state) => state.needRefresh)
  const refreshing = useAppUpdateStore((state) => state.refreshing)
  const applyUpdate = useAppUpdateStore((state) => state.applyUpdate)

  if (!needRefresh) {
    return null
  }

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 border-b border-amber-600/50 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 backdrop-blur"
      // backdrop-blur restored on mobile too (2026-08-29) -- fixed +
      // backdrop-filter is a known iOS Safari combo that detaches a fixed
      // element (MobileBottomNav) mid-scroll. The nav's own translateZ(0)
      // didn't stop this recurring when blur lived on other elements, so
      // this element's own translateZ(0) below is the actual bet this time:
      // promote every blurred element to its own compositing layer, not
      // just the fixed nav bar. If the drift bug returns, this is the
      // theory that failed.
      style={{ transform: 'translateZ(0)' }}
    >
      <span>A new version of Ascension Idle is available.</span>
      <button
        type="button"
        disabled={refreshing}
        onClick={applyUpdate}
        className="shrink-0 rounded-lg border border-amber-500 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  )
}
