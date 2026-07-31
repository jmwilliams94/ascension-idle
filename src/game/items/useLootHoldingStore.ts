import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useInventoryStore, occupiedSlotCount, INVENTORY_SLOT_CAP, type ItemInstance } from './useInventoryStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'

// Loot Holding (confirmed with the user, 2026-07-30): where a server-resolved
// kill's item drop lands when Inventory is full — replaces the old interactive
// "choose what to discard" prompt, which doesn't have a natural moment to
// appear anymore now that kills resolve in the background (see
// resolveCombat.ts / supabase/functions/resolve-combat). A simple ~100-slot
// holding area; claiming moves an item into Inventory whenever there's room.
// Extended (2026-07-31) to also hold a pending Meteor/DragonBall drop
// (currency_type set, template_id null) alongside its original gear-drop
// shape (template_id set, currency_type null) — see CLAUDE.md's Warehouse
// economy redesign note.
export const LOOT_HOLDING_CAP = 100

export interface LootHoldingEntry {
  id: string
  template_id: string | null
  quality_tier: string | null
  currency_type: 'meteor' | 'dragonball' | null
  created_at: string
}

interface ClaimResult {
  ok: boolean
  error?: 'not_found' | 'not_owner'
  item?: ItemInstance
  currency_type?: 'meteor' | 'dragonball'
  new_count?: number
}

interface LootHoldingState {
  entries: LootHoldingEntry[]
  loaded: boolean
  busy: boolean
  loadLootHolding: (characterId: string) => Promise<void>
  // Appends entries granted by a resolve-combat response without a refetch.
  addEntries: (entries: LootHoldingEntry[]) => void
  claim: (holdingId: string) => Promise<ClaimResult>
}

export const useLootHoldingStore = create<LootHoldingState>((set) => ({
  entries: [],
  loaded: false,
  busy: false,

  loadLootHolding: async (characterId) => {
    const { data, error } = await supabase
      .from('loot_holding')
      .select('id, template_id, quality_tier, currency_type, created_at')
      .eq('character_id', characterId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Failed to load loot holding', error)
      return
    }

    set({ entries: (data ?? []) as LootHoldingEntry[], loaded: true })
  },

  addEntries: (entries) => {
    if (entries.length === 0) return
    set((state) => ({ entries: [...state.entries, ...entries] }))
  },

  claim: async (holdingId) => {
    // A currency-type entry doesn't need this pre-check (it doesn't call
    // through here — see below) since claiming it doesn't create an
    // item_instances row; only gear claims need the room check up front.
    if (occupiedSlotCount(useInventoryStore.getState().items) >= INVENTORY_SLOT_CAP) {
      return { ok: false }
    }

    set({ busy: true })
    const { data, error } = await supabase.rpc('claim_loot_holding', { holding_id: holdingId })
    set({ busy: false })

    if (error) {
      console.error('Claim loot holding call failed', error)
      return { ok: false }
    }

    const result = data as ClaimResult

    if (result.ok && result.item) {
      useInventoryStore.getState().addItem(result.item)
      set((state) => ({ entries: state.entries.filter((entry) => entry.id !== holdingId) }))
    } else if (result.ok && result.currency_type && typeof result.new_count === 'number') {
      if (result.currency_type === 'meteor') {
        useCurrencyStore.getState().setMeteors(result.new_count)
      } else {
        useCurrencyStore.getState().setDragonballs(result.new_count)
      }
      set((state) => ({ entries: state.entries.filter((entry) => entry.id !== holdingId) }))
    }

    return result
  },
}))
