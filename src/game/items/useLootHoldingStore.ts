import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useInventoryStore, occupiedSlotCount, INVENTORY_SLOT_CAP, type ItemInstance } from './useInventoryStore'
import { useBankStore, BANK_SLOT_CAP } from './useBankStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'

// Loot Holding (confirmed with the user, 2026-07-30): where a server-resolved
// kill's item drop lands when Inventory is full — replaces the old interactive
// "choose what to discard" prompt, which doesn't have a natural moment to
// appear anymore now that kills resolve in the background (see
// resolveCombat.ts / supabase/functions/resolve-combat). A simple ~100-slot
// holding area; claiming moves an item into Inventory whenever there's room.
// Extended (2026-07-31) to also hold a pending Comet/Fallen Star drop
// (currency_type set, template_id null) alongside its original gear-drop
// shape (template_id set, currency_type null) — see CLAUDE.md's Warehouse
// economy redesign note.
export const LOOT_HOLDING_CAP = 100

export interface LootHoldingEntry {
  id: string
  template_id: string | null
  quality_tier: string | null
  composition_level: number
  currency_type: 'comet' | 'fallen_star' | null
  created_at: string
}

interface ClaimResult {
  ok: boolean
  // 'inventory_full' is a client-only synthetic error (same convention as
  // useBankStore's own pre-checks) — the pre-check below never reaches the
  // server when it fires.
  error?: 'not_found' | 'not_owner' | 'inventory_full'
  item?: ItemInstance
  currency_type?: 'comet' | 'fallen_star'
  new_count?: number
}

// sell_loot_holding (2026-07-31) — sells a pending gear drop straight out of
// Loot Holding for gold, without claiming it into Inventory first. Mirrors
// sell_item's own price formula exactly (see the migration). Currency-type
// entries (Comet/Fallen Star) are rejected server-side with 'not_sellable' —
// the UI only ever offers this on gear entries to begin with.
interface SellResult {
  ok: boolean
  error?: 'not_found' | 'not_owner' | 'not_sellable'
  gold_gained?: number
  gold?: number
  ap_gained?: number
  ascension_points?: number
}

// bank_loot_holding (2026-08-05) — routes a pending Comet/Fallen Star
// straight into the account-wide swap-model Bank (players.bank_comets/
// bank_fallen_stars), bypassing the character's own comet_count/
// fallen_star_count entirely — the point being it never needs a free
// Inventory slot the way claim does (a claimed unit becomes its own
// non-stacking Inventory tile). Confirmed with the user after a full
// Inventory left them stuck on a claim screen unable to progress: "let's
// add a bank button for comets and fallen stars so if our inventory is full
// we have the option to bank them." Gear entries are rejected server-side
// with 'not_bankable' — the UI only ever offers this on currency entries.
// UI-labeled "Store" now (2026-08-07 redesign, see below) — same action,
// unified terminology with storeGear's own "Store" for gear.
interface BankResult {
  ok: boolean
  error?: 'not_found' | 'not_owner' | 'not_bankable'
  currency_type?: 'comet' | 'fallen_star'
  new_bank_balance?: number
}

// store_loot_holding_to_bank (2026-08-07) — the gear equivalent of bank()
// above: inserts straight into item_instances with location='bank' (account-
// wide Bank Storage), bypassing Inventory entirely. Currency entries are
// rejected server-side with 'not_storable_here' — they already have their
// own route via bank() above, into the liquid currency Bank rather than a
// physical Storage tile.
interface StoreGearResult {
  ok: boolean
  // 'storage_full' is a client-only synthetic error (same convention as
  // claim's own 'inventory_full' pre-check) — never reaches the server.
  error?: 'not_found' | 'not_owner' | 'not_storable_here' | 'storage_full'
  item?: ItemInstance
}

interface LootHoldingState {
  entries: LootHoldingEntry[]
  loaded: boolean
  busy: boolean
  loadLootHolding: (characterId: string) => Promise<void>
  // Appends entries granted by a resolve-combat response without a refetch.
  addEntries: (entries: LootHoldingEntry[]) => void
  claim: (holdingId: string) => Promise<ClaimResult>
  sell: (holdingId: string) => Promise<SellResult>
  bank: (holdingId: string) => Promise<BankResult>
  storeGear: (holdingId: string) => Promise<StoreGearResult>
}

export const useLootHoldingStore = create<LootHoldingState>((set) => ({
  entries: [],
  loaded: false,
  busy: false,

  loadLootHolding: async (characterId) => {
    const { data, error } = await supabase
      .from('loot_holding')
      .select('id, template_id, quality_tier, composition_level, currency_type, created_at')
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
    // Applies to currency entries too, not just gear (comment corrected
    // 2026-08-05 — this used to claim otherwise, which was already stale:
    // a claimed Comet/Fallen Star has been its own non-stacking Inventory
    // tile since 2026-07-31, so it needs a free slot exactly like gear
    // does). A player whose Inventory is genuinely full has no way to claim
    // either kind here — see the bank() action below for the way out.
    if (occupiedSlotCount(useInventoryStore.getState().items) >= INVENTORY_SLOT_CAP) {
      return { ok: false, error: 'inventory_full' }
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
      if (result.currency_type === 'comet') {
        useCurrencyStore.getState().setComets(result.new_count)
      } else {
        useCurrencyStore.getState().setFallenStars(result.new_count)
      }
      set((state) => ({ entries: state.entries.filter((entry) => entry.id !== holdingId) }))
    }

    return result
  },

  sell: async (holdingId) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('sell_loot_holding', { holding_id: holdingId })
    set({ busy: false })

    if (error) {
      console.error('Sell loot holding call failed', error)
      return { ok: false }
    }

    const result = data as SellResult

    if (result.ok && typeof result.gold_gained === 'number') {
      // gold-only — addRewards(gold, 0) adds gold without touching EXP/level,
      // same convention useInventoryStore.sellItem already uses.
      useProgressionStore.getState().addRewards(result.gold_gained, 0)
      if (typeof result.ap_gained === 'number' && result.ap_gained > 0) {
        usePlayerRecordStore.getState().addAscensionPoints(result.ap_gained)
      }
      set((state) => ({ entries: state.entries.filter((entry) => entry.id !== holdingId) }))
    }

    return result
  },

  bank: async (holdingId) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('bank_loot_holding', { holding_id: holdingId })
    set({ busy: false })

    if (error) {
      console.error('Bank loot holding call failed', error)
      return { ok: false }
    }

    const result = data as BankResult

    if (result.ok && result.currency_type && typeof result.new_bank_balance === 'number') {
      usePlayerRecordStore
        .getState()
        .setBankBalances(
          result.currency_type === 'comet'
            ? { bankComets: result.new_bank_balance }
            : { bankFallenStars: result.new_bank_balance },
        )
      set((state) => ({ entries: state.entries.filter((entry) => entry.id !== holdingId) }))
    }

    return result
  },

  storeGear: async (holdingId) => {
    // Bank Storage's own 40-slot cap (BANK_SLOT_CAP) has no server-side
    // enforcement — same established trust model as depositItemToStorage
    // (see useBankStore.ts) — so this pre-check is the only thing standing
    // between a Store click and an over-cap Storage.
    if (useBankStore.getState().occupiedSlotCount() >= BANK_SLOT_CAP) {
      return { ok: false, error: 'storage_full' }
    }

    set({ busy: true })
    const { data, error } = await supabase.rpc('store_loot_holding_to_bank', { holding_id: holdingId })
    set({ busy: false })

    if (error) {
      console.error('Store loot holding to bank call failed', error)
      return { ok: false }
    }

    const result = data as StoreGearResult

    if (result.ok && result.item) {
      useBankStore.getState().addBankedItem(result.item)
      set((state) => ({ entries: state.entries.filter((entry) => entry.id !== holdingId) }))
    }

    return result
  },
}))
