import { useEffect } from 'react'
import { useCombatStore } from './useCombatStore'
import { resolveCombat } from './resolveCombat'
import { useActiveCharacterStore } from '../../lib/useActiveCharacterStore'
import { useZoneStore } from '../zones/useZoneStore'

const TICK_INTERVAL_MS = 100

// How often the background reconciliation call fires while actively fighting.
// The local 100ms tick loop above stays fully instant for HP bars/attack
// pacing/log flavor text — this is what actually confirms gold/EXP/item/
// currency rewards server-side (see resolveCombat.ts), a few seconds behind
// the predicted numbers the log already showed. No perceptible combat lag:
// the fighting itself never waits on this.
//
// Shortened from 15000 to 4000 (2026-08-05, confirmed with the user — "I
// dislike the huge delays and no exp reward when something dies"), alongside
// making the level bar itself predictive (see useProgressionStore's
// predictedLevel) — the two together close most of the gap between "you see
// a kill happen" and "the real numbers are confirmed." Costs more frequent
// Edge Function calls while actively fighting; worth it for how much
// snappier this feels.
const RESOLVE_INTERVAL_MS = 4000

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

  useEffect(() => {
    // Only resolves while actively fighting — this also happens to guard
    // against a spurious call firing when useZoneStore.hydrate first restores
    // a saved zone/monster selection on load, since isFighting is still false
    // at that point (GameShell only calls start() after its own load effect
    // and the offline-progress check both finish).
    const resolve = () => {
      const characterId = useActiveCharacterStore.getState().characterId
      if (characterId && useCombatStore.getState().isFighting) {
        void resolveCombat(characterId, 'live')
      }
    }

    const intervalId = window.setInterval(resolve, RESOLVE_INTERVAL_MS)

    // Same trigger set usePersistGameState already uses for the character
    // autosave — a resolve here is a "close out this window" moment, same
    // spirit as a save.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') resolve()
    }
    const handleBeforeUnload = () => resolve()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)

    // Resolve immediately on a monster/zone switch or on stopping, so a
    // partial window doesn't sit unconfirmed until the next periodic tick.
    // KNOWN LIMITATION: this relies on firing before the debounced character
    // autosave persists the new selection (it fires synchronously on the
    // local state change, well ahead of the ~2s debounce) — not airtight
    // against every possible race, but self-corrects on the next periodic
    // resolve regardless; revisit if this proves to actually matter in
    // practice.
    const unsubscribeZone = useZoneStore.subscribe((state, prevState) => {
      if (state.selectedMonsterId !== prevState.selectedMonsterId || state.currentZoneId !== prevState.currentZoneId) {
        resolve()
      }
    })
    // Resolve immediately on a kill (2026-11, reported by the user — reward
    // timing felt "hit and miss," landing during a kill sometimes and only
    // once the next monster had already spawned other times). Root cause:
    // the periodic RESOLVE_INTERVAL_MS poll above has no relationship to the
    // actual kill/respawn cycle's phase, so which poll happens to cross the
    // server's own deterministic "a kill completed" threshold is essentially
    // random relative to the client's own visual kill moment. respawnReadyAt
    // flips from 0 to a real timestamp at exactly that visual moment (see
    // its own field comment) — triggering a resolve right then ties the two
    // together as tightly as this architecture allows, without reverting to
    // a much shorter (egress-costly) polling interval.
    const unsubscribeRespawn = useCombatStore.subscribe((state, prevState) => {
      if (state.respawnReadyAt > 0 && prevState.respawnReadyAt === 0) {
        resolve()
      }
    })
    // Deliberately bypasses resolve()'s own isFighting guard above — by the
    // time this fires, isFighting has already flipped to false, so resolve()
    // would always no-op here (bug, fixed 2026-08-22: this "final resolve"
    // silently never ran, leaving combat_last_resolved_at stale at whatever
    // the last periodic tick stamped — switching to Mining and back later
    // then replayed that entire away window as a Hunting catch-up, since the
    // server only ever sees now - combat_last_resolved_at).
    const unsubscribeCombat = useCombatStore.subscribe((state, prevState) => {
      if (prevState.isFighting && !state.isFighting) {
        const characterId = useActiveCharacterStore.getState().characterId
        if (characterId) {
          void resolveCombat(characterId, 'live')
        }
      }
    })

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      unsubscribeZone()
      unsubscribeRespawn()
      unsubscribeCombat()
    }
  }, [])

  return null
}
