import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useInventoryFullWarningStore } from '../items/useInventoryFullWarningStore'
import { useLootHoldingStore } from '../items/useLootHoldingStore'
import { markDropSourced } from '../items/dropSourceTracking'
import { useAchievementsStore } from '../achievements/useAchievementsStore'
import { usePetToastStore } from '../achievements/usePetToastStore'
import { useKillRewardToastStore } from '../hud/useKillRewardToastStore'
import { ENEMY_TYPES, type EnemyTypeId } from '../zones/zoneData'
import { useCombatStore } from './useCombatStore'
import { serializeByKey } from './serializeByKey'

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
  character?: {
    gold: number
    exp: number
    level: number
    comets: number
    fallenStars: number
    cometScrolls: number
    // 2026-11 bug fix — see useCombatStore's syncPlayerMp for the full
    // writeup. null when no MP-costing skill was active this resolve.
    currentMp?: number | null
  }
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

// Serialized per character (see serializeByKey.ts for the full race this
// closes — resolve-combat's kills-delta race could otherwise double-credit
// gold/EXP/kill-count within a single visible respawn gap).
export function resolveCombat(characterId: string, mode: ResolveCombatMode): Promise<ResolveCombatResult | null> {
  return serializeByKey(characterId, () => resolveCombatInner(characterId, mode))
}

async function resolveCombatInner(characterId: string, mode: ResolveCombatMode): Promise<ResolveCombatResult | null> {
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
  if (typeof result.character.currentMp === 'number') {
    useCombatStore.getState().syncPlayerMp(result.character.currentMp)
  }

  // Live-only "kill confirmed" toast (2026-08-29, requested by the user —
  // see useKillRewardToastStore.ts's own comment) — fires only once this
  // response has actually confirmed a real kill, never predictively. Offline
  // catch-up gets its own dedicated OfflineProgressModal summary instead;
  // firing this too on login would be a redundant, out-of-place popup.
  if (mode === 'live' && result.gained && result.gained.kills > 0) {
    useKillRewardToastStore.getState().show({
      gold: result.gained.gold,
      exp: result.gained.exp,
      kills: result.gained.kills,
      rareKills: result.gained.rareKills,
    })
  }

  for (const item of result.itemsGranted ?? []) {
    useInventoryStore.getState().addItem(item)
    markDropSourced(item.id)
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

// Resets combat_last_resolved_at to now with zero reward grant — called only
// when Hunting is *entered* from Mining (CombatPage.tsx's handleFight), so a
// stale pointer left over from however long ago Hunting last ran doesn't get
// replayed as a catch-up the instant it resumes. See the migration
// (20260930110000_touch_last_resolved_on_mode_switch.sql) for why this is a
// dedicated RPC rather than going through resolveCombat itself.
export async function touchCombatLastResolvedAt(characterId: string): Promise<void> {
  const { error } = await supabase.rpc('touch_combat_last_resolved_at', { p_character_id: characterId })
  if (error) {
    console.error('touch_combat_last_resolved_at failed', error)
  }
}

export interface ClaimHuntingSlotResult {
  ok: boolean
  previous_hunter_id?: string | null
  previous_hunter_name?: string | null
}

// Hunting Slot exclusivity (2026-10-23, reported by the user) — only one
// character per account may hold a live Hunting session at a time, since
// offline catch-up is resolved independently per character (see
// CLAUDE.persistence.md's AFK/offline simulation note) and several
// characters all parked on Hunting could otherwise each claim the same
// real-world elapsed away-time. Called from CombatPage.tsx's handleFight
// whenever Hunting is entered/resumed — auto-takeover, no confirmation
// (confirmed by the user): always succeeds for the caller's own character,
// silently displacing whoever held the slot before (clearing their
// selected_monster_id server-side, which is what actually stops their own
// future resolve-combat calls from accruing anything). See the migration
// (20261023000000_hunting_slot_exclusivity.sql) for the full mechanism.
export async function claimHuntingSlot(characterId: string): Promise<ClaimHuntingSlotResult> {
  const { data, error } = await supabase.rpc('claim_hunting_slot', { p_character_id: characterId })
  if (error) {
    console.error('claim_hunting_slot failed', error)
    return { ok: false }
  }
  return data as ClaimHuntingSlotResult
}

// Called when a character that currently holds the Hunting slot voluntarily
// switches itself to Mining (MiningModePanel.tsx's handleMine) — frees the
// slot immediately instead of leaving it pointed at a character that isn't
// actually hunting anymore until someone else claims it.
export async function releaseHuntingSlot(characterId: string): Promise<void> {
  const { error } = await supabase.rpc('release_hunting_slot', { p_character_id: characterId })
  if (error) {
    console.error('release_hunting_slot failed', error)
  }
}
