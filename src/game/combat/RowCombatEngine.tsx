import { useEffect } from 'react'
import { useRowCombatStore } from './useRowCombatStore'
import { resolveRowCombat } from './resolveRowCombat'
import { useActiveCharacterStore } from '../../lib/useActiveCharacterStore'

const TICK_INTERVAL_MS = 100
// Same cadence as CombatEngine.tsx's own RESOLVE_INTERVAL_MS, for
// consistency — see resolve-row-combat/index.ts's ROW_LIVE_LIVENESS_
// THRESHOLD_MS (10s) for the actual hard AFK cutoff this cadence stays
// comfortably under.
const RESOLVE_INTERVAL_MS = 4000

// Non-visual driver for Row Combat — sibling to CombatEngine.tsx, mounted
// unconditionally alongside it in GameShell. Unlike CombatEngine, this one's
// resolve loop is guarded on "at least one row slot enabled" rather than a
// single isFighting flag, and — critically — going AFK must fully STOP
// accrual here (no offline/idle path exists for this mode at all), so the
// visibilitychange/beforeunload triggers below aren't just a nicety, they're
// half of how that hard requirement is enforced (the other half is
// resolve-row-combat's own server-side liveness cutoff).
export default function RowCombatEngine() {
  useEffect(() => {
    const id = window.setInterval(() => {
      useRowCombatStore.getState().runTick(Date.now())
    }, TICK_INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const resolve = () => {
      const characterId = useActiveCharacterStore.getState().characterId
      if (characterId && useRowCombatStore.getState().slots.some((s) => s.enabled)) {
        void resolveRowCombat(characterId)
      }
    }

    const intervalId = window.setInterval(resolve, RESOLVE_INTERVAL_MS)

    // Same trigger set CombatEngine.tsx uses — a resolve here is what
    // actually stops row combat from accruing further once the tab goes
    // background/closes, since the next resolve call (whenever it happens)
    // will find the gap past the server's liveness cutoff and zero it.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') resolve()
    }
    const handleBeforeUnload = () => resolve()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  return null
}
