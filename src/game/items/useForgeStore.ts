import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useCompositionStore, type CompositionStones } from './useCompositionStore'
import { useInventoryStore, type ItemInstance } from './useInventoryStore'

// Shape returned by the quality_upgrade/level_upgrade Postgres functions (see
// migration 20260727050000). Both currency deduction and the item write happen
// server-side in one transaction — the client only ever reflects the result.
interface QualityUpgradeResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner' | 'already_max_quality' | 'not_enough_dragonballs'
  upgraded?: boolean
  quality_tier?: string
  cost?: number
  dragonballs?: number
  dragonballs_spent?: number
  dragonballs_remaining?: number
  // Armor-only RNG side effect (see 20260802010000_add_gear_sockets.sql) — the
  // item's full sockets array (unchanged if socket_gained is false) and
  // whether this particular attempt happened to roll a new one.
  sockets?: ItemInstance['sockets']
  socket_gained?: boolean
}

interface LevelUpgradeResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner' | 'already_max_level' | 'not_enough_meteors' | 'no_upgrade_path'
  upgraded?: boolean
  level?: number
  // The item's new template on success (Level Upgrade now advances the item to
  // the next tier in its family's chain — see the migration/CLAUDE.md note),
  // unchanged on failure.
  template_id?: string
  cost?: number
  meteors?: number
  meteors_spent?: number
  meteors_remaining?: number
  // Same armor-only RNG socket side effect as Quality Upgrade above.
  sockets?: ItemInstance['sockets']
  socket_gained?: boolean
}

// Shape returned by unlock_weapon_socket (guaranteed, player-paid — weapons
// only, see CLAUDE.md's Sockets section for why this is asymmetric with
// armor's RNG-on-upgrade path above).
interface UnlockWeaponSocketResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner' | 'not_a_weapon' | 'max_sockets' | 'not_enough_dragonballs'
  sockets?: ItemInstance['sockets']
  cost?: number
  dragonballs?: number
  dragonballs_spent?: number
  dragonballs_remaining?: number
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
    | 'no_points_contributed'
  composition_level?: number
  composition_points?: number
  points_required_for_next?: number
  stones?: CompositionStones
}

interface ForgeState {
  busy: boolean
  qualityUpgrade: (itemId: string) => Promise<QualityUpgradeResult>
  levelUpgrade: (itemId: string) => Promise<LevelUpgradeResult>
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
    if (result.ok && typeof result.dragonballs_remaining === 'number') {
      useCurrencyStore.getState().setDragonballs(result.dragonballs_remaining)
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
    if (result.ok && typeof result.meteors_remaining === 'number') {
      useCurrencyStore.getState().setMeteors(result.meteors_remaining)
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
    }
    if (result.ok && typeof result.dragonballs_remaining === 'number') {
      useCurrencyStore.getState().setDragonballs(result.dragonballs_remaining)
    }

    return result
  },
}))
