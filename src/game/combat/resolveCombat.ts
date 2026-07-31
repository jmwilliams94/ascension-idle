import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useLootHoldingStore } from '../items/useLootHoldingStore'

// The single client-side entry point into the resolve-combat Edge Function —
// see supabase/functions/resolve-combat/index.ts and CLAUDE.md's Loot section.
// This is now the ONLY thing that actually grants combat rewards; local combat
// (useCombatStore.runTick) only predicts/displays them for instant feedback.
// Called periodically during live play (CombatEngine.tsx) and once at login
// for the away-time gap (offlineProgress.ts) — one server-side resolver for
// both, instead of two parallel client-side ones.
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
}

export async function resolveCombat(characterId: string): Promise<ResolveCombatResult | null> {
  const { data, error } = await supabase.functions.invoke('resolve-combat', { body: { characterId } })

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

  return result
}
