import { supabase } from '../../lib/supabaseClient'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useInventoryFullWarningStore } from '../items/useInventoryFullWarningStore'
import { markDropSourced } from '../items/dropSourceTracking'
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
  gained?: { kills: number; ore: number; umbriteOre: number; gems: number }
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
    markDropSourced(item.id)
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
  const umbriteOreCount = result.gained?.umbriteOre ?? 0
  const gemCount = result.gained?.gems ?? 0
  if (oreCount > 0) {
    useMiningStore.getState().logGrant(`Found ${oreCount} ore.`, 'ore')
  }
  if (umbriteOreCount > 0) {
    // Rare, promotion-material-tier drop (Cinderleaf only) — its own
    // callout, same "special find" treatment as the Gem line below rather
    // than folding into the generic ore message.
    useMiningStore.getState().logGrant(`Found ${umbriteOreCount} Umbrite Ore!`, 'ore')
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

// Resets mining_last_resolved_at to now with zero reward grant — called only
// when Mining is *entered* from Hunting (MiningModePanel.tsx's
// stopHuntingIfActive), so a stale pointer left over from however long ago
// Mining last ran doesn't get replayed as a catch-up the instant it resumes.
// See resolveCombat.ts's touchCombatLastResolvedAt (the Hunting-side mirror)
// and the migration (20260930110000_touch_last_resolved_on_mode_switch.sql).
export async function touchMiningLastResolvedAt(characterId: string): Promise<void> {
  const { error } = await supabase.rpc('touch_mining_last_resolved_at', { p_character_id: characterId })
  if (error) {
    console.error('touch_mining_last_resolved_at failed', error)
  }
}
