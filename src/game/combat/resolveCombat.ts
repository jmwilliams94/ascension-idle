import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useInventoryFullWarningStore } from '../items/useInventoryFullWarningStore'
import { useLootHoldingStore } from '../items/useLootHoldingStore'
import { useAchievementsStore } from '../achievements/useAchievementsStore'
import { usePetToastStore } from '../achievements/usePetToastStore'
import { ENEMY_TYPES, type EnemyTypeId } from '../zones/zoneData'
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
  gained?: { kills: number; rareKills: number; gold: number; exp: number; comets: number; fallenStars: number }
  character?: { gold: number; exp: number; level: number; comets: number; fallenStars: number; cometScrolls: number }
  leveledUp?: boolean
  itemsGranted?: ItemInstance[]
  itemsHeld?: { template_id: string }[]
  currencyHeld?: { currency_type: 'comet' | 'fallen_star' }[]
  // Live mode only — set when a kill rolled a drop that had nowhere to go,
  // so the server stopped simulating further attacks for the rest of this
  // window. Never set for an offline-mode call (that window always overflows
  // to Loot Holding instead, unchanged from before this mode split existed).
  inventoryFull?: boolean
  // Achievements & Pets, Stage 1 (see CLAUDE.md) — this monster's updated
  // kill totals (both ladders) and whether its pet was newly obtained this
  // call. Absent when there's no selected monster (see the early-return
  // response in resolve-combat/index.ts).
  monsterId?: string | null
  characterKillCount?: number
  accountKillCount?: number
  petObtained?: string | null
  // Gear Durability (2026-08-14) — updated { id, durability } for whichever
  // equipped items decayed this window (see resolve-combat's own comment on
  // why this piggybacks on resolve_combat_apply_rewards rather than a
  // separate RPC). Empty/absent when nothing was equipped or nothing decayed.
  durabilityUpdates?: { id: string; durability: number }[]
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

  useProgressionStore.getState().applyServerCombatResult({
    goldGained: result.gained?.gold ?? 0,
    exp: result.character.exp,
    level: result.character.level,
  })
  useCurrencyStore.getState().setComets(result.character.comets)
  useCurrencyStore.getState().setFallenStars(result.character.fallenStars)
  useCurrencyStore.getState().setCometScrolls(result.character.cometScrolls)

  for (const item of result.itemsGranted ?? []) {
    useInventoryStore.getState().addItem(item)
  }

  for (const { id, durability } of result.durabilityUpdates ?? []) {
    useInventoryStore.getState().patchItem(id, { durability })
  }

  if ((result.itemsHeld && result.itemsHeld.length > 0) || (result.currencyHeld && result.currencyHeld.length > 0)) {
    // resolve-combat doesn't return loot_holding row ids (it's fire-and-forget
    // from its perspective) — a lightweight refetch keeps this simple rather
    // than threading ids back through the response. Covers both gear and
    // currency-type holds (Comet/Fallen Star — see useLootHoldingStore).
    void useLootHoldingStore.getState().loadLootHolding(characterId)
  }

  if (result.inventoryFull) {
    useCombatStore.getState().stopForInventoryFull()
    useInventoryFullWarningStore.getState().trigger()
  }

  if (result.monsterId && typeof result.characterKillCount === 'number' && typeof result.accountKillCount === 'number') {
    useAchievementsStore
      .getState()
      .applyResolveResult(result.monsterId, result.characterKillCount, result.accountKillCount, result.petObtained ?? null)
  }

  if (result.petObtained) {
    const type = ENEMY_TYPES[result.petObtained as EnemyTypeId]
    useCombatStore.getState().logPetObtained(type?.displayName ?? 'monster')
    // Live-only celebration toast — offline-mode pet grants get their own
    // dedicated callout in OfflineProgressModal instead (see
    // offlineProgress.ts), since there's no live page open to show a
    // transient toast on while the player was away.
    if (mode === 'live') {
      usePetToastStore.getState().show(type?.displayName ?? 'monster')
    }
  }

  return result
}
