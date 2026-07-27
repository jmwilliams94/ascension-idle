import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useInventoryStore } from './useInventoryStore'

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
}

interface LevelUpgradeResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner' | 'already_max_level' | 'not_enough_meteors'
  upgraded?: boolean
  level?: number
  cost?: number
  meteors?: number
  meteors_spent?: number
  meteors_remaining?: number
}

interface ForgeState {
  busy: boolean
  qualityUpgrade: (itemId: string) => Promise<QualityUpgradeResult>
  levelUpgrade: (itemId: string) => Promise<LevelUpgradeResult>
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
      useInventoryStore.getState().patchItem(itemId, { level: result.level })
    }
    if (result.ok && typeof result.meteors_remaining === 'number') {
      useCurrencyStore.getState().setMeteors(result.meteors_remaining)
    }

    return result
  },
}))
