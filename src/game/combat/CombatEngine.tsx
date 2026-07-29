import { useEffect } from 'react'
import { useCombatStore } from './useCombatStore'

const TICK_INTERVAL_MS = 100

// Non-visual driver — mounted unconditionally in GameShell (not inside CombatPage)
// so the fight keeps advancing while the player is on another tab. An idle game
// must keep fighting in the background; gating this to the Combat page would
// defeat the point.
export default function CombatEngine() {
  useEffect(() => {
    const id = window.setInterval(() => {
      useCombatStore.getState().runTick(Date.now())
    }, TICK_INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [])

  return null
}
