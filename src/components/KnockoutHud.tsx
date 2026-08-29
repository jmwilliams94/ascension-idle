import { useEffect, useState } from 'react'
import { useCombatStore } from '../game/combat/useCombatStore'

const TICK_MS = 250

// Shown in GameShell's top HUD strip, alongside QuiverWarningHud/
// InventoryFullWarningHud — same "renders nothing while the condition
// doesn't hold" pattern. Surfaces the knockout death timer
// (useCombatStore.reviveAt/KNOCKOUT_LOCKOUT_MS) with a live countdown —
// before this, the only signal a player got was a single Combat Log line
// ("You were knocked out! Recovering for 10s...") which is easy to miss
// since the log is collapsible and can be closed (2026-08-07, reported by
// the user: no indicator when knocked out that they're locked out of
// combat).
export default function KnockoutHud() {
  const reviveAt = useCombatStore((state) => state.reviveAt)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (reviveAt <= 0) {
      return undefined
    }

    const interval = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(interval)
  }, [reviveAt])

  if (reviveAt <= 0) {
    return null
  }

  const remainingSeconds = Math.max(0, Math.ceil((reviveAt - nowMs) / 1000))

  return (
    <div className="shrink-0 rounded-lg border border-red-500 bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-200 lg:backdrop-blur">
      Knocked out — reviving in {remainingSeconds}s
    </div>
  )
}
