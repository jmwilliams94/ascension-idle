import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useCompositionStore, type CompositionStones } from './useCompositionStore'
import { useGemStore } from './useGemStore'
import type { GemCounts } from './gemCatalog'
import { useInventoryStore, type ItemInstance } from './useInventoryStore'
import type { GemTier, GemTypeId } from './gemCatalog'
import { useFireworkStore } from './useFireworkStore'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'

// Shape returned by the quality_upgrade/level_upgrade Postgres functions (see
// migration 20260727050000). Both currency deduction and the item write happen
// server-side in one transaction — the client only ever reflects the result.
interface QualityUpgradeResult {
  ok: boolean
  // 'not_enough_room_to_unbundle' (2026-08-07) — the cost would need
  // auto-unbundling a Scroll to cover (see ensure_loose_currency), but there
  // isn't Inventory room for the newly-unbundled loose units, so the whole
  // attempt was refused up front rather than partially completing.
  error?: 'item_not_found' | 'not_owner' | 'already_max_quality' | 'not_enough_fallen_stars' | 'not_enough_room_to_unbundle'
  upgraded?: boolean
  quality_tier?: string
  cost?: number
  fallen_stars?: number
  fallen_stars_spent?: number
  fallen_stars_remaining?: number
  // Post-unbundle Scroll count (2026-08-07 fix — see migration
  // 20260808020000_forge_functions_return_scroll_counts.sql) — without this,
  // a Scroll consumed via ensure_loose_currency's auto-unbundle left the
  // client's local Scroll count stale until an unrelated full reload.
  fallen_star_scrolls_remaining?: number
  // VIP Auto-Use Bank Material (2026-09-05, see
  // 20261227000000_vip_forge_bank_material_client_sync_fix.sql) — how much of
  // this attempt's cost, if any, was drawn from the account Bank rather than
  // the character's own Inventory, and the Bank's new balance afterward.
  // Present (0/actual balance) even when nothing was drawn.
  fallen_star_bank_used?: number
  fallen_star_bank_remaining?: number
  // Armor-only RNG side effect (see 20260802010000_add_gear_sockets.sql) — the
  // item's full sockets array (unchanged if socket_gained is false) and
  // whether this particular attempt happened to roll a new one.
  sockets?: ItemInstance['sockets']
  socket_gained?: boolean
}

interface LevelUpgradeResult {
  ok: boolean
  error?:
    | 'item_not_found'
    | 'not_owner'
    | 'already_max_level'
    | 'not_enough_comets'
    | 'no_upgrade_path'
    | 'not_enough_room_to_unbundle'
    // Equipped-item-only guard (2026-08-14, mirrors master_forge_upgrade's own
    // check) — an item pulled from ordinary Inventory has no such limit.
    | 'exceeds_character_level'
    // 2026-08-31: a weapon at required_level 120+ can no longer Level Upgrade
    // here at all — Master Forge only past that point, flat 1 Fallen Star per
    // level (see masterForgeUpgrade below). levelUpgradeCurrency in
    // forgeCosts.ts is the client mirror of this same 120+ boundary.
    | 'weapon_requires_master_forge'
  upgraded?: boolean
  level?: number
  // The item's new template on success (Level Upgrade now advances the item to
  // the next tier in its family's chain — see the migration/CLAUDE.md note),
  // unchanged on failure.
  template_id?: string
  cost?: number
  comets?: number
  comets_spent?: number
  comets_remaining?: number
  // Same post-unbundle-Scroll-count fix as Quality Upgrade above (Comet side).
  comet_scrolls_remaining?: number
  // Same VIP Auto-Use Bank Material fields as Quality Upgrade above (Comet side).
  comet_bank_used?: number
  comet_bank_remaining?: number
  // Same armor-only RNG socket side effect as Quality Upgrade above.
  sockets?: ItemInstance['sockets']
  socket_gained?: boolean
}

// Shape returned by master_forge_upgrade (2026-08-05, see migration
// 20260805030000) — guaranteed success on either upgrade type, priced at
// 1.5x the expected manual cost (see forgeCosts.ts's previewMasterForgeCost,
// which mirrors this for the pre-commit cost preview). exceeds_character_level
// is Master-Forge-specific — manual level_upgrade has no equivalent check.
interface MasterForgeUpgradeResult {
  ok: boolean
  error?:
    | 'item_not_found'
    | 'not_owner'
    | 'invalid_upgrade_type'
    | 'already_max_quality'
    | 'already_max_level'
    | 'no_upgrade_path'
    | 'exceeds_character_level'
    | 'not_enough_fallen_stars'
    | 'not_enough_comets'
    | 'not_enough_room_to_unbundle'
  upgrade_type?: 'quality' | 'level'
  cost?: number
  currency?: 'comet' | 'fallen_star'
  quality_tier?: string
  level?: number
  template_id?: string
  fallen_stars_remaining?: number | null
  comets_remaining?: number | null
  // Post-unbundle Scroll count for whichever currency this attempt actually
  // spent (see the fix note on QualityUpgradeResult above) — not split by
  // currency since only one is ever relevant per call (upgrade_type decides).
  scrolls_remaining?: number
  // Same VIP Auto-Use Bank Material fields as Quality/Level Upgrade above —
  // not split by currency here either, keyed off `currency` instead.
  bank_used?: number
  bank_remaining?: number
  result_level?: number
  character_level?: number
  sockets?: ItemInstance['sockets']
  socket_gained?: boolean
}

// Shape returned by unlock_weapon_socket (guaranteed, player-paid — weapons
// only, see CLAUDE.md's Sockets section for why this is asymmetric with
// armor's RNG-on-upgrade path above).
interface UnlockWeaponSocketResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner' | 'not_a_weapon' | 'max_sockets' | 'not_enough_fallen_stars' | 'not_enough_room_to_unbundle'
  sockets?: ItemInstance['sockets']
  cost?: number
  fallen_stars?: number
  fallen_stars_spent?: number
  fallen_stars_remaining?: number
  fallen_star_scrolls_remaining?: number
}

// Shape returned by socket_gem (see migration 20260810040000_add_socket_gem.sql)
// — fills or overwrites one already-unlocked socket with a gem the character
// owns. Deliberately no "unsocket" counterpart anywhere — a filled socket can
// only ever be overwritten with a different gem, never returned to empty.
interface SocketGemResult {
  ok: boolean
  error?: 'invalid_gem' | 'invalid_tier' | 'invalid_socket_index' | 'item_not_found' | 'not_owner' | 'socket_not_unlocked' | 'not_enough_gems'
  sockets?: ItemInstance['sockets']
  gems?: GemCounts
}

// Shape returned by composition_feed (see migration 20260728000000). No RNG and no
// "upgraded" boolean — feeding always applies its full point value, the only
// question is how far it advances the item (possibly across several tiers in one
// call, hence points_required_for_next reflecting whatever tier it landed on).
interface CompositionFeedResult {
  ok: boolean
  error?:
    | 'item_not_found'
    | 'not_owner'
    | 'invalid_stone_tier'
    | 'not_enough_stones'
    | 'fuel_not_owned'
    | 'fuel_is_target_item'
    | 'fuel_locked'
    | 'no_points_contributed'
    | 'already_max_composition'
  composition_level?: number
  composition_points?: number
  points_required_for_next?: number
  stones?: CompositionStones
}

// Shape returned by enchant_item_hp (see migration
// 20260813070000_enchantress_bless.sql, which reworked this to return the
// item's full resulting `enchant` object rather than just its own `hp` key —
// necessary once blessPct could live on the same object, so the client never
// has to hand-merge two independent RPCs' partial views of one jsonb column)
// — the gem is consumed regardless of outcome; `applied` tells the caller
// whether the roll beat the item's existing enchant_hp (only a higher roll
// ever overwrites it).
interface EnchantHpResult {
  ok: boolean
  error?: 'invalid_gem' | 'invalid_tier' | 'item_not_found' | 'not_owner' | 'not_enough_gems'
  rolled?: number
  applied?: boolean
  enchant_hp?: number
  enchant?: { hp?: number; blessPct?: number }
  gems?: GemCounts
}

// Shape returned by bless_item (see migration
// 20260813070000_enchantress_bless.sql) — deterministic, no RNG: always
// succeeds and consumes exactly one Ascended Bastion Gem unless the item is
// already at BLESS_MAX_PCT (already_max_bless, gem left unspent).
interface BlessItemResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner' | 'already_max_bless' | 'not_enough_gems'
  bless_pct?: number
  enchant?: { hp?: number; blessPct?: number }
  gems?: GemCounts
}

// Shape returned by quality_upgrade_scroll/level_upgrade_scroll (see
// migration 20260813090000_forge_scroll_batch_upgrade.sql) -- consumes one
// Comet Scroll/Fallen Star Scroll to chain up to 10 upgrade attempts in one
// call, each re-evaluated against the item's state as of that roll. No
// per-roll breakdown is shown client-side (by design) -- rolls_attempted/
// rolls_succeeded are carried in the response mostly for completeness;
// `upgraded` (true if rolls_succeeded > 0) is all the UI actually branches
// on, same as the single-attempt result shapes above.
interface QualityUpgradeScrollResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner' | 'already_max_quality' | 'not_enough_fallen_star_scrolls'
  upgraded?: boolean
  rolls_attempted?: number
  rolls_succeeded?: number
  quality_tier?: string
  fallen_star_scrolls_remaining?: number
  sockets?: ItemInstance['sockets']
  socket_gained?: boolean
}

interface LevelUpgradeScrollResult {
  ok: boolean
  error?:
    | 'item_not_found'
    | 'not_owner'
    | 'already_max_level'
    | 'no_upgrade_path'
    | 'not_enough_comet_scrolls'
    // Same equipped-item-only guard as LevelUpgradeResult above — refused
    // upfront (before the Scroll is spent) if even the first roll in the
    // batch would already exceed the character's level.
    | 'exceeds_character_level'
    // 2026-08-31: a weapon already at required_level 120+ can't even start a
    // Comet Scroll batch — Master Forge only past that point. A batch that
    // starts below 120 still runs, but silently stops (no refund) the moment
    // a roll would cross above 120 — see level_upgrade_scroll's SQL.
    | 'weapon_requires_master_forge'
  upgraded?: boolean
  rolls_attempted?: number
  rolls_succeeded?: number
  level?: number
  template_id?: string
  comet_scrolls_remaining?: number
  sockets?: ItemInstance['sockets']
  socket_gained?: boolean
}

interface ForgeState {
  busy: boolean
  qualityUpgrade: (itemId: string) => Promise<QualityUpgradeResult>
  levelUpgrade: (itemId: string) => Promise<LevelUpgradeResult>
  // Scroll batch variants (2026-08-13) -- same effect as qualityUpgrade/
  // levelUpgrade above but chains up to 10 attempts server-side off one
  // Scroll, see CLAUDE.md's Forge section for the full rules.
  qualityUpgradeScroll: (itemId: string) => Promise<QualityUpgradeScrollResult>
  levelUpgradeScroll: (itemId: string) => Promise<LevelUpgradeScrollResult>
  // stoneAmounts keys are tier "1".."4"; fuelItemIds are other gear items to
  // sacrifice for their composition value (see CLAUDE.md's Composition section).
  compositionFeed: (
    itemId: string,
    stoneAmounts: Record<string, number>,
    fuelItemIds: string[],
  ) => Promise<CompositionFeedResult>
  // Weapons only — guaranteed, player-paid socket unlock (see CLAUDE.md's
  // Sockets section). Armor gets sockets as a side effect of qualityUpgrade/
  // levelUpgrade above instead, not through this action.
  unlockWeaponSocket: (itemId: string) => Promise<UnlockWeaponSocketResult>
  // Master Forge (2026-08-05) — guaranteed success on either upgrade type,
  // priced dynamically (see MasterForgeUpgradeResult's own comment).
  masterForgeUpgrade: (itemId: string, upgradeType: 'quality' | 'level') => Promise<MasterForgeUpgradeResult>
  // Sockets tab (2026-08-10) — fills/overwrites socketIndex with one unit of
  // the given gem+tier, spent from the character's own gems.
  socketGem: (itemId: string, socketIndex: number, gemId: string, gemTier: string) => Promise<SocketGemResult>
  // Enchantress tab (2026-08-13) — consumes one gem of the given type+tier,
  // rolling a flat HP bonus for the item within that tier's range (see
  // gemCatalog.ts's ENCHANT_HP_RANGE_BY_TIER). Only overwrites the item's
  // existing enchant if the new roll is higher; the gem is spent either way.
  enchantItemHp: (itemId: string, gemId: GemTypeId, gemTier: GemTier) => Promise<EnchantHpResult>
  // Enchantress "Bless" tab (2026-08-13) — consumes one Ascended Bastion Gem
  // to advance the item's Blessed Damage Reduction one step along
  // gemCatalog.ts's BLESS_PCT_STEPS. Deterministic (no roll) and refuses the
  // attempt upfront (gem not spent) once the item is already at the cap.
  blessItem: (itemId: string) => Promise<BlessItemResult>
}

export const useForgeStore = create<ForgeState>((set) => ({
  busy: false,

  qualityUpgrade: async (itemId) => {
    set({ busy: true })

    const { data, error } = await supabase.rpc('quality_upgrade', { item_id: itemId })

    set({ busy: false })

    if (error) {
      console.error('Quality upgrade call failed', error)
      return { ok: false }
    }

    const result = data as QualityUpgradeResult

    if (result.ok && result.quality_tier) {
      useInventoryStore.getState().patchItem(itemId, { quality_tier: result.quality_tier })
    }
    if (result.ok && result.sockets) {
      useInventoryStore.getState().patchItem(itemId, { sockets: result.sockets })
    }
    if (result.ok && result.socket_gained) {
      useFireworkStore.getState().fire()
    }
    if (result.ok && typeof result.fallen_stars_remaining === 'number') {
      useCurrencyStore.getState().setFallenStars(result.fallen_stars_remaining)
    }
    if (result.ok && typeof result.fallen_star_scrolls_remaining === 'number') {
      useCurrencyStore.getState().setFallenStarScrolls(result.fallen_star_scrolls_remaining)
    }
    if (result.ok && typeof result.fallen_star_bank_remaining === 'number') {
      usePlayerRecordStore.getState().setBankBalances({ bankFallenStars: result.fallen_star_bank_remaining })
    }

    return result
  },

  levelUpgrade: async (itemId) => {
    set({ busy: true })

    const { data, error } = await supabase.rpc('level_upgrade', { item_id: itemId })

    set({ busy: false })

    if (error) {
      console.error('Level upgrade call failed', error)
      return { ok: false }
    }

    const result = data as LevelUpgradeResult

    if (result.ok && typeof result.level === 'number') {
      useInventoryStore.getState().patchItem(itemId, {
        level: result.level,
        ...(result.template_id ? { template_id: result.template_id } : {}),
      })
    }
    if (result.ok && result.sockets) {
      useInventoryStore.getState().patchItem(itemId, { sockets: result.sockets })
    }
    if (result.ok && result.socket_gained) {
      useFireworkStore.getState().fire()
    }
    if (result.ok && typeof result.comets_remaining === 'number') {
      useCurrencyStore.getState().setComets(result.comets_remaining)
    }
    if (result.ok && typeof result.comet_scrolls_remaining === 'number') {
      useCurrencyStore.getState().setCometScrolls(result.comet_scrolls_remaining)
    }
    if (result.ok && typeof result.comet_bank_remaining === 'number') {
      usePlayerRecordStore.getState().setBankBalances({ bankComets: result.comet_bank_remaining })
    }

    return result
  },

  qualityUpgradeScroll: async (itemId) => {
    set({ busy: true })

    const { data, error } = await supabase.rpc('quality_upgrade_scroll', { item_id: itemId })

    set({ busy: false })

    if (error) {
      console.error('Quality upgrade scroll call failed', error)
      return { ok: false }
    }

    const result = data as QualityUpgradeScrollResult

    if (result.ok && result.quality_tier) {
      useInventoryStore.getState().patchItem(itemId, { quality_tier: result.quality_tier })
    }
    if (result.ok && result.sockets) {
      useInventoryStore.getState().patchItem(itemId, { sockets: result.sockets })
    }
    if (result.ok && result.socket_gained) {
      useFireworkStore.getState().fire()
    }
    if (result.ok && typeof result.fallen_star_scrolls_remaining === 'number') {
      useCurrencyStore.getState().setFallenStarScrolls(result.fallen_star_scrolls_remaining)
    }

    return result
  },

  levelUpgradeScroll: async (itemId) => {
    set({ busy: true })

    const { data, error } = await supabase.rpc('level_upgrade_scroll', { item_id: itemId })

    set({ busy: false })

    if (error) {
      console.error('Level upgrade scroll call failed', error)
      return { ok: false }
    }

    const result = data as LevelUpgradeScrollResult

    if (result.ok && typeof result.level === 'number') {
      useInventoryStore.getState().patchItem(itemId, {
        level: result.level,
        ...(result.template_id ? { template_id: result.template_id } : {}),
      })
    }
    if (result.ok && result.sockets) {
      useInventoryStore.getState().patchItem(itemId, { sockets: result.sockets })
    }
    if (result.ok && result.socket_gained) {
      useFireworkStore.getState().fire()
    }
    if (result.ok && typeof result.comet_scrolls_remaining === 'number') {
      useCurrencyStore.getState().setCometScrolls(result.comet_scrolls_remaining)
    }

    return result
  },

  compositionFeed: async (itemId, stoneAmounts, fuelItemIds) => {
    set({ busy: true })

    const { data, error } = await supabase.rpc('composition_feed', {
      item_id: itemId,
      stone_amounts: stoneAmounts,
      fuel_item_ids: fuelItemIds,
    })

    set({ busy: false })

    if (error) {
      console.error('Composition feed call failed', error)
      return { ok: false }
    }

    const result = data as CompositionFeedResult

    if (result.ok) {
      if (typeof result.composition_level === 'number' && typeof result.composition_points === 'number') {
        useInventoryStore
          .getState()
          .patchItem(itemId, { composition_level: result.composition_level, composition_points: result.composition_points })
      }
      if (result.stones) {
        useCompositionStore.getState().setStones(result.stones)
      }
      if (fuelItemIds.length > 0) {
        useInventoryStore.getState().removeItems(fuelItemIds)
      }
    }

    return result
  },

  unlockWeaponSocket: async (itemId) => {
    set({ busy: true })

    const { data, error } = await supabase.rpc('unlock_weapon_socket', { item_id: itemId })

    set({ busy: false })

    if (error) {
      console.error('Unlock weapon socket call failed', error)
      return { ok: false }
    }

    const result = data as UnlockWeaponSocketResult

    if (result.ok && result.sockets) {
      useInventoryStore.getState().patchItem(itemId, { sockets: result.sockets })
      useFireworkStore.getState().fire()
    }
    if (result.ok && typeof result.fallen_stars_remaining === 'number') {
      useCurrencyStore.getState().setFallenStars(result.fallen_stars_remaining)
    }
    if (result.ok && typeof result.fallen_star_scrolls_remaining === 'number') {
      useCurrencyStore.getState().setFallenStarScrolls(result.fallen_star_scrolls_remaining)
    }

    return result
  },

  masterForgeUpgrade: async (itemId, upgradeType) => {
    set({ busy: true })

    const { data, error } = await supabase.rpc('master_forge_upgrade', { item_id: itemId, upgrade_type: upgradeType })

    set({ busy: false })

    if (error) {
      console.error('Master Forge upgrade call failed', error)
      return { ok: false }
    }

    const result = data as MasterForgeUpgradeResult

    if (result.ok && result.upgrade_type === 'quality' && result.quality_tier) {
      useInventoryStore.getState().patchItem(itemId, { quality_tier: result.quality_tier })
    }
    if (result.ok && result.upgrade_type === 'level' && typeof result.level === 'number') {
      useInventoryStore.getState().patchItem(itemId, {
        level: result.level,
        ...(result.template_id ? { template_id: result.template_id } : {}),
      })
    }
    if (result.ok && result.sockets) {
      useInventoryStore.getState().patchItem(itemId, { sockets: result.sockets })
    }
    if (result.ok && result.socket_gained) {
      useFireworkStore.getState().fire()
    }
    if (result.ok && typeof result.fallen_stars_remaining === 'number') {
      useCurrencyStore.getState().setFallenStars(result.fallen_stars_remaining)
    }
    if (result.ok && typeof result.comets_remaining === 'number') {
      useCurrencyStore.getState().setComets(result.comets_remaining)
    }
    if (result.ok && typeof result.scrolls_remaining === 'number') {
      if (result.upgrade_type === 'quality') {
        useCurrencyStore.getState().setFallenStarScrolls(result.scrolls_remaining)
      } else if (result.upgrade_type === 'level') {
        useCurrencyStore.getState().setCometScrolls(result.scrolls_remaining)
      }
    }
    if (result.ok && typeof result.bank_remaining === 'number' && result.currency) {
      usePlayerRecordStore.getState().setBankBalances(
        result.currency === 'comet' ? { bankComets: result.bank_remaining } : { bankFallenStars: result.bank_remaining }
      )
    }

    return result
  },

  socketGem: async (itemId, socketIndex, gemId, gemTier) => {
    set({ busy: true })

    const { data, error } = await supabase.rpc('socket_gem', {
      item_id: itemId,
      socket_index: socketIndex,
      gem_id: gemId,
      gem_tier: gemTier,
    })

    set({ busy: false })

    if (error) {
      console.error('Socket gem call failed', error)
      return { ok: false }
    }

    const result = data as SocketGemResult

    if (result.ok && result.sockets) {
      useInventoryStore.getState().patchItem(itemId, { sockets: result.sockets })
    }
    if (result.ok && result.gems) {
      useGemStore.getState().setGems(result.gems)
    }

    return result
  },

  enchantItemHp: async (itemId, gemId, gemTier) => {
    set({ busy: true })

    const { data, error } = await supabase.rpc('enchant_item_hp', { item_id: itemId, gem_id: gemId, gem_tier: gemTier })

    set({ busy: false })

    if (error) {
      console.error('Enchant item HP call failed', error)
      return { ok: false }
    }

    const result = data as EnchantHpResult

    if (result.ok && result.enchant) {
      useInventoryStore.getState().patchItem(itemId, { enchant: result.enchant })
    }
    if (result.ok && result.gems) {
      useGemStore.getState().setGems(result.gems)
    }

    return result
  },

  blessItem: async (itemId) => {
    set({ busy: true })

    const { data, error } = await supabase.rpc('bless_item', { item_id: itemId })

    set({ busy: false })

    if (error) {
      console.error('Bless item call failed', error)
      return { ok: false }
    }

    const result = data as BlessItemResult

    if (result.ok && result.enchant) {
      useInventoryStore.getState().patchItem(itemId, { enchant: result.enchant })
    }
    if (result.ok && result.gems) {
      useGemStore.getState().setGems(result.gems)
    }

    return result
  },
}))
