import { useZoneStore } from '../zones/useZoneStore'
import { resolveCombat } from './resolveCombat'
import { ENEMY_TYPES, type EnemyTypeId } from '../zones/zoneData'

// Idle/AFK progress while away, and the login-time reconciliation of live
// combat both go through the same resolve-combat Edge Function now (see
// resolveCombat.ts / supabase/functions/resolve-combat) — the server's own
// combat_last_resolved_at naturally shows a large elapsed gap after any period
// away, so this file no longer needs its own local simulation loop at all.
// Superseded: the previous version reused combatResolver.ts to run a bounded
// client-side attack loop and grant rewards directly — that's now the
// server's job exclusively (closing the item-drop/arrow-consumption trust gap
// this simulator's own direct grants used to be part of).

// Below this elapsed-window size, don't bother showing the "welcome back"
// summary modal — a normal page refresh/reload would otherwise pop it for a
// few seconds' worth of nothing. Exported so GameShell's resume-detection can
// use the same number to decide whether a "Calculating…" spinner is worth
// showing before the result is even known (see the hiddenAt gating there).
export const OFFLINE_SUMMARY_THRESHOLD_MS = 60_000

export interface OfflineProgressResult {
  elapsedMs: number
  kills: number
  rareKills: number
  gold: number
  exp: number
  itemsFoundCount: number
  comets: number
  fallenStars: number
  // Pet drop rate/notification pass (2026-08-03, confirmed with the user) —
  // display name (already resolved from the raw monster id, same
  // ENEMY_TYPES lookup resolveCombat.ts's own live-toast handling uses), so
  // OfflineProgressModal can render it directly with no lookup of its own.
  // Null when no pet was obtained during the away window.
  petObtained: string | null
}

// Discriminated so a caller can tell "genuinely nothing happened" (no
// monster ever selected, or the elapsed window was too small to matter --
// expected, not an error) apart from "we don't actually know what happened"
// (the resolve-combat call itself failed or came back ok:false) — the two
// used to both collapse to a bare `null`, which is what let a real sync
// failure look identical to a quiet no-op: GameShell would show the
// "Calculating…" spinner because the away-gap looked large, then this
// resolved to null and the whole modal vanished with nothing shown at all
// (reported by the user, 2026-08-15 — "Calculating Rewards pop up and then
// nothing"). GameShell now shows an explicit "couldn't sync" state for
// 'error', and stays silent only for 'nothing'.
export type OfflineProgressOutcome =
  | { status: 'nothing' }
  | { status: 'error' }
  | { status: 'shown'; result: OfflineProgressResult }

// Called once from GameShell's load effect, after character/inventory/arrow
// loads resolve, and again from its resume-detection heartbeat.
export async function runOfflineProgressCheck(characterId: string): Promise<OfflineProgressOutcome> {
  if (!useZoneStore.getState().selectedMonsterId) {
    return { status: 'nothing' }
  }

  const result = await resolveCombat(characterId, 'offline')

  if (!result || !result.ok) {
    return { status: 'error' }
  }

  if (!result.gained || (result.elapsedMs ?? 0) < OFFLINE_SUMMARY_THRESHOLD_MS) {
    return { status: 'nothing' }
  }

  return {
    status: 'shown',
    result: {
      elapsedMs: result.elapsedMs ?? 0,
      kills: result.gained.kills,
      rareKills: result.gained.rareKills,
      gold: result.gained.gold,
      exp: result.gained.exp,
      itemsFoundCount: (result.itemsGranted?.length ?? 0) + (result.itemsHeld?.length ?? 0),
      comets: result.gained.comets,
      fallenStars: result.gained.fallenStars,
      petObtained: result.petObtained ? (ENEMY_TYPES[result.petObtained as EnemyTypeId]?.displayName ?? 'monster') : null,
    },
  }
}
