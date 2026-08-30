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
    //
    // Also skips while no monster is actually present — a respawn gap
    // (respawnReadyAt > 0) or a knockout (reviveAt > 0), the same "neither
    // side acts" states runTick itself gates on (v1.118.18, bug fix reported
    // by the user: "I got experience/gold toast 1 second after killing the
    // enemy and also 2 seconds before a new one spawned"). resolve-combat's
    // reward math is a continuous elapsed-time average (see
    // CLAUDE.combat-and-loot.md's cycle-time model) — it has no notion of
    // "a monster is currently up," so a periodic tick landing mid-gap can
    // legitimately cross a whole-kill threshold purely from background
    // clock time elapsing, showing a second reward toast with nothing new
    // having happened on screen. Skipping here doesn't lose anything —
    // combat_last_resolved_at simply keeps accumulating unclaimed until the
    // next call that isn't mid-gap, and the kill trigger further down calls
    // resolveCombat directly (bypassing this same gate) so a real kill is
    // never delayed by it.
    const resolve = () => {
      const characterId = useActiveCharacterStore.getState().characterId
      const combatState = useCombatStore.getState()
      if (characterId && combatState.isFighting && combatState.respawnReadyAt === 0 && combatState.reviveAt === 0) {
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
    // random relative to the client's own visual kill moment.
    // lastKillSignal (a monotonically increasing counter, bumped on every
    // real kill) is the trigger — triggering a resolve right then ties the
    // two together as tightly as this architecture allows, without
    // reverting to a much shorter (egress-costly) polling interval.
    // Deliberately bypasses resolve()'s own respawnReadyAt/reviveAt gate
    // above (calls resolveCombat directly, same pattern as the stop trigger
    // below). **Was respawnReadyAt's own 0->nonzero transition until 2026-11
    // (requested by the user — the respawn gap now runs concurrently with
    // the fight, see RESPAWN_GAP_MS's own comment)**: once a fight can run
    // longer than the gap and skip the visible waiting state entirely on a
    // kill, respawnReadyAt no longer reliably transitions on every kill, so
    // a dedicated always-increments counter replaced it as the trigger.
    const unsubscribeKill = useCombatStore.subscribe((state, prevState) => {
      if (state.lastKillSignal !== prevState.lastKillSignal) {
        const characterId = useActiveCharacterStore.getState().characterId
        if (characterId) {
          void resolveCombat(characterId, 'live')
        }
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
      unsubscribeKill()
      unsubscribeCombat()
    }
  }, [])

  return null
}
