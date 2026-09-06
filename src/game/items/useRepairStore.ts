import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useActiveCharacterStore } from '../../lib/useActiveCharacterStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useInventoryStore } from './useInventoryStore'

// Shape returned by repair_all_items (see the migration adding it) — a
// single flat action, no per-item picker (confirmed with the user): repairs
// every one of the character's own damaged items in one shot for one lump
// gold cost.
interface RepairAllResult {
  ok: boolean
  error?: 'not_owner' | 'already_full' | 'not_enough_gold'
  cost?: number
  gold?: number
  gold_spent?: number
  gold_remaining?: number
  items_repaired?: number
  repaired_items?: { id: string; durability: number }[]
}

// Shape returned by repair_item (20261229020000_repair_single_item.sql) —
// the per-item counterpart to Repair All, added 2026-09-06 (requested by the
// user). Same ownership check/cost formula, scoped to one item.
interface RepairItemResult {
  ok: boolean
  error?: 'not_owner' | 'item_not_found' | 'already_full' | 'not_enough_gold'
  cost?: number
  gold?: number
  gold_spent?: number
  gold_remaining?: number
  item?: { id: string; durability: number }
}

interface RepairState {
  busy: boolean
  repairingItemId: string | null
  repairAll: () => Promise<RepairAllResult>
  repairItem: (itemId: string) => Promise<RepairItemResult>
}

export const useRepairStore = create<RepairState>((set) => ({
  busy: false,
  repairingItemId: null,

  repairAll: async () => {
    const characterId = useActiveCharacterStore.getState().characterId
    if (!characterId) {
      return { ok: false }
    }

    set({ busy: true })
    const { data, error } = await supabase.rpc('repair_all_items', { p_character_id: characterId })
    set({ busy: false })

    if (error) {
      console.error('Repair all items call failed', error)
      return { ok: false }
    }

    const result = data as RepairAllResult

    if (result.ok && result.repaired_items) {
      for (const { id, durability } of result.repaired_items) {
        useInventoryStore.getState().patchItem(id, { durability })
      }
    }
    if (result.ok && typeof result.gold_spent === 'number') {
      useProgressionStore.getState().applyGoldDelta(-result.gold_spent)
    }

    return result
  },

  repairItem: async (itemId) => {
    const characterId = useActiveCharacterStore.getState().characterId
    if (!characterId) {
      return { ok: false }
    }

    set({ repairingItemId: itemId })
    const { data, error } = await supabase.rpc('repair_item', { p_character_id: characterId, p_item_id: itemId })
    set({ repairingItemId: null })

    if (error) {
      console.error('Repair item call failed', error)
      return { ok: false }
    }

    const result = data as RepairItemResult

    if (result.ok && result.item) {
      useInventoryStore.getState().patchItem(result.item.id, { durability: result.item.durability })
    }
    if (result.ok && typeof result.gold_spent === 'number') {
      useProgressionStore.getState().applyGoldDelta(-result.gold_spent)
    }

    return result
  },
}))
