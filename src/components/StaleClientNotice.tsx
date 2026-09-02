import { useEffect, useState } from 'react'
import { useAppUpdateStore } from '../lib/useAppUpdateStore'
import { useStaleClientStore } from '../lib/useStaleClientStore'

// A contextual "that's probably why" nudge (2026-09-02, requested by the
// user) — distinct from UpdateBanner's own persistent, purely-proactive top
// banner (which shows any time a newer build is confirmed available,
// regardless of whether anything has actually gone wrong yet). This only
// ever renders once BOTH staleClientFetch.ts has seen an RPC fail with a
// schema-mismatch shape (useStaleClientStore's lastSchemaErrorAt) AND
// useAppUpdateStore's own needRefresh independently confirms a newer build
// really is installed and waiting — the two-signal requirement (not just
// the error alone) is deliberate: a genuine server-side bug unrelated to
// client staleness never has a newer build to point the player at, so
// needRefresh stays false and this never fires for it, avoiding "please
// refresh" spam on every unrelated error.
//
// Shown at most once per session (useStaleClientStore's noticeShownAt, set
// the moment this decides to show) even if several calls fail in the same
// burst. Auto-hides after AUTO_HIDE_MS (the persistent UpdateBanner is
// still there as the standing reminder) or on manual dismiss — unlike
// UpdateBanner, this one has something real to opt out of (it's a passing
// explanation, not the only path to the fix).
const CORRELATION_WINDOW_MS = 5 * 60_000
const AUTO_HIDE_MS = 12_000
const TICK_MS = 1_000

export default function StaleClientNotice() {
  const needRefresh = useAppUpdateStore((state) => state.needRefresh)
  const refreshing = useAppUpdateStore((state) => state.refreshing)
  const applyUpdate = useAppUpdateStore((state) => state.applyUpdate)
  const lastSchemaErrorAt = useStaleClientStore((state) => state.lastSchemaErrorAt)
  const noticeShownAt = useStaleClientStore((state) => state.noticeShownAt)
  const markNoticeShown = useStaleClientStore((state) => state.markNoticeShown)

  const [dismissed, setDismissed] = useState(false)
  // Date.now() into state via interval, never read live during render —
  // same shape ExperiencePotionHud's own countdown uses (satisfies
  // react-hooks/purity) — purely to re-evaluate the AUTO_HIDE_MS window
  // below on a steady tick while the notice could plausibly be showing.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (noticeShownAt !== null || !needRefresh || lastSchemaErrorAt === null) {
      return
    }
    if (Date.now() - lastSchemaErrorAt > CORRELATION_WINDOW_MS) {
      return
    }
    markNoticeShown()
  }, [needRefresh, lastSchemaErrorAt, noticeShownAt, markNoticeShown])

  useEffect(() => {
    if (noticeShownAt === null || dismissed) {
      return undefined
    }
    const interval = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(interval)
  }, [noticeShownAt, dismissed])

  const visible = noticeShownAt !== null && !dismissed && now - noticeShownAt < AUTO_HIDE_MS

  if (!visible) {
    return null
  }

  return (
    <div className="fixed inset-x-0 top-14 z-[60] flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-lg border border-amber-600/60 bg-slate-950/95 px-4 py-2.5 text-sm text-amber-100 shadow-lg backdrop-blur">
        <span>That action may have failed because your app is out of date.</span>
        <button
          type="button"
          disabled={refreshing}
          onClick={applyUpdate}
          className="shrink-0 rounded-lg border border-amber-500 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 text-amber-300/70 hover:text-amber-200"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
