import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { getActiveGoldDonationEvent, useGoldDonationStore } from '../game/goldDonation/useGoldDonationStore'
import { BUFF_CATEGORY_LABEL, formatDuration } from './GoldDonationCard'

// Dismissable top-of-screen banner for an active Gold Donation buff
// (2026-11, requested by the user) — surfaces the same "Socket unlock
// chance x1.4 — ends in 1m" text GoldDonationCard already shows inside its
// own finished-event container, but visible from anywhere in the app, not
// just while sitting on the Idling > Events sub-tab. Mirrors LevelUpBanner's
// portal/fixed/high-z-index pattern so it renders above everything
// regardless of ancestor stacking/overflow, but unlike that banner (which
// auto-clears on a timer), this one only clears when the buff itself ends or
// the player dismisses it with the X — `dismissedKey` tracks which buff
// instance was dismissed (identified by its end timestamp) so a *new* buff
// starting later still gets its own banner.
export default function GoldDonationBuffBanner() {
  const pool = useGoldDonationStore((state) => state.pool)
  const [now, setNow] = useState(() => Date.now())
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const activeEvent = getActiveGoldDonationEvent(pool, now)
  const buffEndsAtMs = pool?.buffEndsAt ? new Date(pool.buffEndsAt).getTime() : 0

  if (!activeEvent || !pool?.buffEndsAt || dismissedKey === pool.buffEndsAt) {
    return null
  }

  return createPortal(
    // top-20 clears the header (matches LevelUpBanner's own offset) — top-4
    // would sit underneath/inside the app header bar instead of below it.
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[70] flex justify-center px-4">
      <AnimatePresence>
        <motion.div
          key={pool.buffEndsAt}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-emerald-400/60 bg-emerald-400/10 py-1.5 pl-3 pr-2 text-xs font-semibold text-emerald-300 backdrop-blur will-change-transform"
        >
          <span>
            {BUFF_CATEGORY_LABEL[activeEvent.category]} x{activeEvent.multiplier} — ends in {formatDuration(buffEndsAtMs - now)}
          </span>
          <button
            type="button"
            onClick={() => setDismissedKey(pool.buffEndsAt)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-emerald-300/70 hover:bg-emerald-400/20 hover:text-emerald-200"
          >
            ✕
          </button>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  )
}
