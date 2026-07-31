import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useInventoryFullWarningStore } from '../items/useInventoryFullWarningStore'
import { useLootHoldingStore } from '../items/useLootHoldingStore'
import { useCombatStore } from './useCombatStore'

// The single client-side entry point into the resolve-combat Edge Function —
// see supabase/functions/resolve-combat/index.ts and CLAUDE.md's Loot section.
// This is now the ONLY thing that actually grants combat rewards; local combat
// (useCombatStore.runTick) only predicts/displays them for instant feedback.
// Called periodically during live play (CombatEngine.tsx, mode 'live') and
// once at login for the away-time gap (offlineProgress.ts, mode 'offline') —
// one server-side resolver for both, instead of two parallel client-side
// ones. The two modes now diverge on what happens when a drop can't fit in
// Inventory (confirmed with the user, 2026-07-31): live combat stops outright
// (see below) rather than parking the drop in Loot Holding, which is now
// reserved exclusively for the offline/idle catch-up window (surfaced in
// OfflineProgressModal, not a persistent Warehouse card).
export type ResolveCombatMode = 'live' | 'offline'

export interface ResolveCombatResult {
  ok: boolean
  error?: string
  elapsedMs?: number
  gained?: { kills: number; rareKills: number; gold: number; exp: number; meteors: number; dragonballs: number }
  character?: { gold: number; exp: number; level: number; meteors: number; dragonballs: number }
  leveledUp?: boolean
  itemsGranted?: ItemInstance[]
  itemsHeld?: { template_id: string }[]
  currencyHeld?: { currency_type: 'meteor' | 'dragonball' }[]
  // Live mode only — set when a kill rolled a drop that had nowhere to go,
  // so the server stopped simulating further attacks for the rest of this
  // window. Never set for an offline-mode call (that window always overflows
  // to Loot Holding instead, unchanged from before this mode split existed).
  inventoryFull?: boolean
}

export async function resolveCombat(characterId: string, mode: ResolveCombatMode): Promise<ResolveCombatResult | null> {
  const { data, error } = await supabase.functions.invoke('resolve-combat', { body: { characterId, mode } })

  if (error) {
    console.error('resolve-combat call failed', error)
    return null
  }

  const result = data as ResolveCombatResult

  if (!result.ok || !result.character) {
    return result
  }

  useProgressionStore.getState().applyServerCombatResult(result.character)
  useCurrencyStore.getState().setMeteors(result.character.meteors)
  useCurrencyStore.getState().setDragonballs(result.character.dragonballs)

  for (const item of result.itemsGranted ?? []) {
    useInventoryStore.getState().addItem(item)
  }

  if ((result.itemsHeld && result.itemsHeld.length > 0) || (result.currencyHeld && result.currencyHeld.length > 0)) {
    // resolve-combat doesn't return loot_holding row ids (it's fire-and-forget
    // from its perspective) — a lightweight refetch keeps this simple rather
    // than threading ids back through the response. Covers both gear and
    // currency-type holds (Meteor/DragonBall — see useLootHoldingStore).
    void useLootHoldingStore.getState().loadLootHolding(characterId)
  }

  if (result.inventoryFull) {
    useCombatStore.getState().stopForInventoryFull()
    useInventoryFullWarningStore.getState().trigger()
  }

  return result
}
