import { supabase } from '../../lib/supabaseClient'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useInventoryFullWarningStore } from '../items/useInventoryFullWarningStore'
import { markDropSourced } from '../items/dropSourceTracking'
import { useLootHoldingStore } from '../items/useLootHoldingStore'
import { useGemStore } from '../items/useGemStore'
import { useMiningStore } from './useMiningStore'
import { serializeByKey } from '../combat/serializeByKey'

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

// Serialized per character — mirrors resolveCombat.ts's own fix (see
// serializeByKey.ts for the full race this closes). MiningEngine.tsx fires
// resolve calls from several independent, uncoordinated triggers (a 4s
// periodic poll, plus immediate calls on stop/mine-switch/visibility-hide/
// beforeunload) — nothing stopped two of them from being genuinely in
// flight at once. resolve_mining_gather_state's CAS on mining_last_resolved_at
// already prevents two calls from double-crediting the *same* elapsed-time
// window, but the live-mode Inventory-full guard (gearCount read once per
// call, see resolve-mining/index.ts) is a separate snapshot with no such
// protection — two overlapping calls can each read the same starting
// gearCount and each grant ore up to their own independently-computed
// "room left" figure, together overshooting the 40-slot cap. Reported by
// the user as ore overshooting Inventory's max by exactly the room that was
// free when the race happened. Shared queue key with combat/row-combat
// (plain characterId, not a mining-specific key) is deliberate, matching
// resolveRowCombat.ts's own choice — Hunting and Mining are mutually
// exclusive per character anyway, so one queue per character is sufficient.
export function resolveMining(characterId: string, mode: ResolveMiningMode): Promise<ResolveMiningResult | null> {
  return serializeByKey(characterId, () => resolveMiningInner(characterId, mode))
}

async function resolveMiningInner(characterId: string, mode: ResolveMiningMode): Promise<ResolveMiningResult | null> {
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

// Resets mining_last_resolved_at to now with zero reward grant, and clears
// selected_monster_id — called unconditionally whenever Mining is *entered*
// (MiningModePanel.tsx's handleMine), not just when this tab's own local
// isFighting flag happened to be true. That local-only gating used to be
// the whole guard, which is exactly the blind spot that let a *different*
// already-open session for this same character keep resolving Hunting live
// forever after this one switched to Mining (selected_monster_id is
// resolve-combat's own "am I active" guard — see claim_hunting_slot's
// identical mechanism for a *displaced* character; this is the same fix
// applied to a single character's own other mode). See resolveCombat.ts's
// touchCombatLastResolvedAt (the Hunting-side mirror, clears
// selected_mine_id) and the migration
// (20261201000000_mode_switch_clears_other_mode_selection.sql). Routed
// through the same per-character serializeByKey queue as resolveMining/
// resolveCombat so a trailing live resolve triggered by this same switch
// (MiningModePanel's stopHuntingIfActive -> useCombatStore.stop() ->
// CombatEngine's subscription -> resolveCombat) finishes and credits its
// last few seconds before this call clears selected_monster_id out from
// under it.
export function touchMiningLastResolvedAt(characterId: string): Promise<void> {
  return serializeByKey(characterId, () => touchMiningLastResolvedAtInner(characterId))
}

async function touchMiningLastResolvedAtInner(characterId: string): Promise<void> {
  const { error } = await supabase.rpc('touch_mining_last_resolved_at', { p_character_id: characterId })
  if (error) {
    console.error('touch_mining_last_resolved_at failed', error)
  }
}
