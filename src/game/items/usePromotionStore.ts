import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useInventoryStore, type ItemInstance } from './useInventoryStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useCharacterStore } from '../stats/useCharacterStore'
import { useProgressionStore } from '../stats/useProgressionStore'

// Mirrors the promotion_tiers table (see migration 20260901000000). Static
// reference data, readable by anyone — loaded once and cached, same pattern
// as useItemTemplatesStore. items_required/award_items 'currency' names are
// one of 'gold'|'comet'|'fallen_star'; 'item' names reference
// item_templates.name. skills_unlocked is inert flavor text only — no
// ability/skill system exists yet.
export interface PromotionCost {
  kind: 'item' | 'currency'
  name: string
  quantity: number
}

export interface PromotionTier {
  id: string
  class: string
  level: number
  title: string
  items_required: PromotionCost[]
  award_items: PromotionCost[]
  skills_unlocked: string[]
}

interface ConsumedEntry extends PromotionCost {
  item_ids?: string[]
}

// Shape returned by promote_character (see the migration's SQL). Guaranteed
// success once level + affordability are met (no RNG) — cost is only ever
// consumed after every requirement is already confirmed affordable, so
// there's no partial-completion window.
interface PromoteCharacterResult {
  ok: boolean
  error?:
    | 'not_owner'
    | 'no_further_promotion'
    | 'level_too_low'
    | 'cannot_afford'
    | 'template_missing'
    | 'not_enough_room'
    | 'not_enough_room_to_unbundle'
  required_level?: number
  missing?: string
  needed?: number
  owned?: number
  title?: string
  promotion_level?: number
  skills_unlocked?: string[]
  consumed?: ConsumedEntry[]
  granted_items?: ItemInstance[]
  gold?: number
  comet_count?: number
  fallen_star_count?: number
}

interface PromotionState {
  tiers: PromotionTier[]
  loaded: boolean
  busy: boolean
  loadTiers: () => Promise<void>
  promote: (characterId: string) => Promise<PromoteCharacterResult>
}

export const usePromotionStore = create<PromotionState>((set, get) => ({
  tiers: [],
  loaded: false,
  busy: false,

  loadTiers: async () => {
    if (get().loaded) {
      return
    }

    const { data, error } = await supabase
      .from('promotion_tiers')
      .select('id, class, level, title, items_required, award_items, skills_unlocked')

    if (error) {
      console.error('Failed to load promotion tiers', error)
      return
    }

    set({ tiers: (data ?? []) as PromotionTier[], loaded: true })
  },

  promote: async (characterId) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('promote_character', { p_character_id: characterId })
    set({ busy: false })

    if (error) {
      console.error('promote_character failed', error)
      return { ok: false }
    }

    const result = data as PromoteCharacterResult

    if (result.ok) {
      for (const item of result.granted_items ?? []) {
        useInventoryStore.getState().addItem(item)
      }

      const consumedItemIds = (result.consumed ?? []).flatMap((entry) => entry.item_ids ?? [])
      if (consumedItemIds.length > 0) {
        useInventoryStore.getState().removeItems(consumedItemIds)
      }

      if (typeof result.gold === 'number') {
        useProgressionStore.getState().setGold(result.gold)
      }
      if (typeof result.comet_count === 'number') {
        useCurrencyStore.getState().setComets(result.comet_count)
      }
      if (typeof result.fallen_star_count === 'number') {
        useCurrencyStore.getState().setFallenStars(result.fallen_star_count)
      }
      if (typeof result.promotion_level === 'number') {
        useCharacterStore.getState().setPromotionLevel(result.promotion_level)
      }
    }

    return result
  },
}))
