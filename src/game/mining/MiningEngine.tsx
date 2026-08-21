import { useEffect } from 'react'
import { useMiningStore } from './useMiningStore'
import { resolveMining } from './resolveMining'
import { useActiveCharacterStore } from '../../lib/useActiveCharacterStore'
import { useMineStore } from './useMineStore'

const TICK_INTERVAL_MS = 100

// Mirrors CombatEngine.tsx's own two-timer shape. Since Hunting and Mining
// can never both be active (confirmed by the user), this only needs to
// actually fire while useMiningStore.isMining is true — no cross-store
// concurrency handling needed here; the mutual-exclusivity enforcement lives
// at the two activation points (CombatPage.tsx's handleFight/handleMine).
const RESOLVE_INTERVAL_MS = 4000

// Non-visual driver — mounted unconditionally in GameShell (not inside
// CombatPage), same reasoning as CombatEngine: an idle game must keep mining
// advancing in the background.
export default function MiningEngine() {
  useEffect(() => {
    const id = window.setInterval(() => {
      useMiningStore.getState().runTick(Date.now())
    }, TICK_INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const resolve = () => {
      const characterId = useActiveCharacterStore.getState().characterId
      if (characterId && useMiningStore.getState().isMining) {
        void resolveMining(characterId, 'live')
      }
    }

    const intervalId = window.setInterval(resolve, RESOLVE_INTERVAL_MS)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') resolve()
    }
    const handleBeforeUnload = () => resolve()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)

    const unsubscribeMine = useMineStore.subscribe((state, prevState) => {
      if (state.currentMineId !== prevState.currentMineId) {
        resolve()
      }
    })
    const unsubscribeMining = useMiningStore.subscribe((state, prevState) => {
      if (prevState.isMining && !state.isMining) {
        resolve()
      }
    })

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      unsubscribeMine()
      unsubscribeMining()
    }
  }, [])

  return null
}
