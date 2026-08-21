import { supabase } from '../../lib/supabaseClient'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useInventoryFullWarningStore } from '../items/useInventoryFullWarningStore'
import { useLootHoldingStore } from '../items/useLootHoldingStore'
import { useGemStore } from '../items/useGemStore'
import { useMiningStore } from './useMiningStore'

// The single client-side entry point into the resolve-mining Edge Function —
// see supabase/functions/resolve-mining/index.ts. Mirrors resolveCombat.ts's
// shape (called periodically during live mining, once at login for the
// away-time gap) — this is the ONLY thing that actually grants Ore/Gems;
// local mining (useMiningStore.runTick) only predicts/displays for instant
// feedback.
export type ResolveMiningMode = 'live' | 'offline'

export interface ResolveMiningResult {
  ok: boolean
  error?: string
  elapsedMs?: number
  gained?: { kills: number; ore: number; gems: number }
  itemsGranted?: ItemInstance[]
  itemsHeld?: number
  gemsGranted?: Record<string, number>
  gems?: Record<string, number>
  inventoryFull?: boolean
  nodeDisplayName?: string
}

export async function resolveMining(characterId: string, mode: ResolveMiningMode): Promise<ResolveMiningResult | null> {
  const { data, error } = await supabase.functions.invoke('resolve-mining', { body: { characterId, mode } })

  if (error) {
    console.error('resolve-mining call failed', error)
    return null
  }

  const result = data as ResolveMiningResult

  if (!result.ok) {
    return result
  }

  for (const item of result.itemsGranted ?? []) {
    useInventoryStore.getState().addItem(item)
  }

  if (result.gems) {
    useGemStore.getState().setGems(result.gems)
  }

  if ((result.itemsHeld ?? 0) > 0) {
    // resolve-mining doesn't return loot_holding row ids (fire-and-forget
    // from its perspective, same as resolveCombat.ts) — a lightweight
    // refetch keeps this simple rather than threading ids through.
    void useLootHoldingStore.getState().loadLootHolding(characterId)
  }

  const oreCount = result.gained?.ore ?? 0
  const gemCount = result.gained?.gems ?? 0
  if (oreCount > 0) {
    useMiningStore.getState().logGrant(`Found ${oreCount} ore.`, 'ore')
  }
  if (gemCount > 0) {
    useMiningStore.getState().logGrant(`Found ${gemCount} gem${gemCount === 1 ? '' : 's'}!`, 'gem')
  }

  if (result.inventoryFull) {
    useMiningStore.getState().stopForInventoryFull()
    useInventoryFullWarningStore.getState().trigger()
  }

  return result
}
