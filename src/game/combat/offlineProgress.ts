import { useZoneStore } from '../zones/useZoneStore'
import { resolveCombat } from './resolveCombat'

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
// few seconds' worth of nothing.
const OFFLINE_SUMMARY_THRESHOLD_MS = 60_000

export interface OfflineProgressResult {
  elapsedMs: number
  kills: number
  rareKills: number
  gold: number
  exp: number
  itemsFoundCount: number
  meteors: number
  dragonballs: number
}

// Called once from GameShell's load effect, after character/inventory/arrow
// loads resolve. Returns the result for the summary modal, or null if there's
// nothing worth showing (no monster ever selected, the resolve call failed,
// or the elapsed window was too small to matter).
export async function runOfflineProgressCheck(characterId: string): Promise<OfflineProgressResult | null> {
  if (!useZoneStore.getState().selectedMonsterId) {
    return null
  }

  const result = await resolveCombat(characterId, 'offline')

  if (!result || !result.ok || !result.gained || (result.elapsedMs ?? 0) < OFFLINE_SUMMARY_THRESHOLD_MS) {
    return null
  }

  return {
    elapsedMs: result.elapsedMs ?? 0,
    kills: result.gained.kills,
    rareKills: result.gained.rareKills,
    gold: result.gained.gold,
    exp: result.gained.exp,
    itemsFoundCount: (result.itemsGranted?.length ?? 0) + (result.itemsHeld?.length ?? 0),
    meteors: result.gained.meteors,
    dragonballs: result.gained.dragonballs,
  }
}
