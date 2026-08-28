import { useEffect, useState } from 'react'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { VIP_TOKEN_ICON_SRC } from '../game/items/forgeCosts'
import { useVipSettingsModalStore } from '../game/vip/useVipSettingsModalStore'

// Tailwind's default `lg` breakpoint (1024px, unconfigured elsewhere in this
// project — matches every other `lg:` usage). Below it the badge collapses
// to an icon that reveals the days-remaining text in a small popover on tap,
// instead of opening VipSettingsModal directly (2026-08-29, requested by the
// user — "VIP · Nd left" was crowding GameShell's top HUD row on mobile).
// This badge is VIP Settings' only entry point today, so it's unreachable on
// mobile until one exists elsewhere — an accepted tradeoff, not an oversight.
const DESKTOP_MIN_WIDTH = 1024

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= DESKTOP_MIN_WIDTH)
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`)
    const update = () => setIsDesktop(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])
  return isDesktop
}

// Small readout, shown in GameShell's top HUD strip — confirms a VIP Token's
// Use actually worked and shows the remaining time. On desktop, clicking it
// opens VipSettingsModal, VIP's first real gameplay payoff (v1.108.0) —
// auto-sell Ore / auto-salvage / auto-bank / Auto-Forge repeat. Renders
// nothing for a character that's never been VIP, or whose VIP has lapsed
// (vip_expires_at in the past).
export default function VipStatusHud() {
  const vipExpiresAt = useCharacterStore((state) => state.vipExpiresAt)
  const isDesktop = useIsDesktop()
  const [showRemaining, setShowRemaining] = useState(false)

  // Same "Date.now() into state via a slow interval, never read live during
  // render" pattern as LuckyPanel's own free-ticket countdown — this only
  // needs to be roughly live, not to-the-second.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  // Outside-pointerdown/Escape dismissal for the mobile popover, same pattern
  // as GearEquipPopover.
  useEffect(() => {
    if (!showRemaining) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-vip-hud]')) {
        setShowRemaining(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowRemaining(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showRemaining])

  if (!vipExpiresAt) {
    return null
  }

  const remainingMs = new Date(vipExpiresAt).getTime() - now
  if (remainingMs <= 0) {
    return null
  }

  const daysLeft = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))

  return (
    <div className="relative shrink-0" data-vip-hud>
      <button
        type="button"
        onClick={() => (isDesktop ? useVipSettingsModalStore.getState().openModal() : setShowRemaining((current) => !current))}
        title={isDesktop ? `VIP until ${new Date(vipExpiresAt).toLocaleString()} — click for VIP settings` : undefined}
        // No backdrop-blur (dropped 2026-10-01, reported by the user — mobile
        // nav bar drifting slightly during scroll). backdrop-filter anywhere on
        // the page is the documented trigger for iOS Safari's position: fixed
        // detach bug (see MobileBottomNav.tsx's own translateZ(0) comment,
        // which names backdrop-blur specifically as "the original trigger").
        // This badge only started actually rendering once VIP status became
        // reachable/tested this session — the class was here since v1.107.0,
        // just never active on-screen before.
        className="flex items-center gap-1 rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20"
      >
        <img src={VIP_TOKEN_ICON_SRC} alt="VIP" className="h-4 w-4 object-contain" />
        <span className="hidden lg:inline">VIP · {daysLeft}d left</span>
      </button>

      {showRemaining && !isDesktop && (
        <div className="absolute left-0 top-full z-50 mt-1 whitespace-nowrap rounded-lg border border-amber-500/60 bg-slate-950/95 px-3 py-1.5 text-xs font-medium text-amber-300 shadow-xl shadow-black/50">
          VIP · {daysLeft}d left
        </div>
      )}
    </div>
  )
}
