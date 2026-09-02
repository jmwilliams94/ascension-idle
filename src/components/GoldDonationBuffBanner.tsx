import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getActiveGoldDonationEvent, useGoldDonationStore } from '../game/goldDonation/useGoldDonationStore'
import { useAppUpdateStore } from '../lib/useAppUpdateStore'
import { BUFF_CATEGORY_LABEL, formatDuration } from './GoldDonationCard'

// Dismissable top-of-screen banner for an active Gold Donation buff
// (2026-11, requested by the user) — surfaces the same "Socket unlock
// chance x1.4 — ends in 1m" text GoldDonationCard already shows inside its
// own finished-event container, but visible from anywhere in the app, not
// just while sitting on the Idling > Events sub-tab.
//
// Restyled (2026-11, requested by the user) to match UpdateBanner.tsx's own
// full-width top bar exactly — same fixed/border-b/backdrop-blur "glass" bar
// and centered text+button layout — just in the event's emerald/green
// instead of the update banner's amber, with a "Dismiss" button instead of
// "Refresh" since there's nothing to apply here, only opt out of seeing it.
// Only clears when the buff itself ends or the player dismisses it;
// `dismissedKey` tracks which buff instance was dismissed (identified by its
// end timestamp) so a *new* buff starting later still gets its own banner.
//
// Hidden outright whenever UpdateBanner itself is showing (needRefresh) —
// both are `fixed inset-x-0 top-0` bars occupying the same slot, and the
// update prompt should always win it rather than the two stacking or
// fighting over z-index.
export default function GoldDonationBuffBanner() {
  const pool = useGoldDonationStore((state) => state.pool)
  const needRefresh = useAppUpdateStore((state) => state.needRefresh)
  const [now, setNow] = useState(() => Date.now())
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const activeEvent = getActiveGoldDonationEvent(pool, now)
  const buffEndsAtMs = pool?.buffEndsAt ? new Date(pool.buffEndsAt).getTime() : 0

  if (needRefresh || !activeEvent || !pool?.buffEndsAt || dismissedKey === pool.buffEndsAt) {
    return null
  }

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 border-b border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 backdrop-blur"
      // Same translateZ(0) compositing-layer hedge as UpdateBanner (see its
      // own comment) — matters here too now that this uses the same fixed +
      // backdrop-filter combination.
      style={{ transform: 'translateZ(0)' }}
    >
      <span>
        {BUFF_CATEGORY_LABEL[activeEvent.category]} x{activeEvent.multiplier} — ends in {formatDuration(buffEndsAtMs - now)}
      </span>
      <button
        type="button"
        onClick={() => setDismissedKey(pool.buffEndsAt)}
        className="shrink-0 rounded-lg border border-emerald-500 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
      >
        Dismiss
      </button>
    </div>,
    document.body,
  )
}
