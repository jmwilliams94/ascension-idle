import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useCompositionStore, type CompositionStones } from './useCompositionStore'
import { useInventoryStore, occupiedSlotCount, INVENTORY_SLOT_CAP, type ItemInstance } from './useInventoryStore'

// Warehouse: per-character storage for gear tokens and Composition stones (its
// own 40-slot cap, exactly mirroring Inventory's INVENTORY_SLOT_CAP), plus
// account-wide currency (gold/meteors/dragonballs) shared across every character
// on the account — see CLAUDE.md's Accounts & Characters section.
export const WAREHOUSE_SLOT_CAP = 40

// One row per distinct (template_id, composition_level) combo — fully fungible
// once deposited (identity-destroying bank rule), so it occupies exactly one
// Warehouse slot regardless of count, same as one arrow stack occupying one
// Inventory slot regardless of its count.
export interface WarehouseItemEntry {
  id: string
  template_id: string
  composition_level: number
  count: number
}

type Currency = 'gold' | 'meteors' | 'dragonballs'

interface TransferStoneResult {
  ok: boolean
  error?: 'invalid_direction' | 'invalid_request' | 'not_owner' | 'not_enough_stones'
  stones?: CompositionStones
  warehouse_stones?: CompositionStones
}

interface TransferCurrencyResult {
  ok: boolean
  error?: 'invalid_currency' | 'invalid_direction' | 'invalid_amount' | 'not_owner' | 'not_enough_balance'
  character_balance?: number
  bank_balance?: number
}

interface DepositItemResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner'
  template_id?: string
  composition_level?: number
  count?: number
}

interface WithdrawItemResult {
  ok: boolean
  // 'inventory_full' is a client-only synthetic error — never returned by the RPC
  // itself, added before the call even fires (mirrors grantItemDrop's own
  // client-side cap check for the same 40-slot Inventory limit).
  error?: 'not_owner' | 'not_found' | 'inventory_full'
  item?: ItemInstance
  warehouse_count?: number
}

const DEFAULT_STONES: CompositionStones = { '1': 0, '2': 0, '3': 0, '4': 0 }

function totalStoneCount(stones: CompositionStones): number {
  return Object.values(stones).reduce((sum, count) => sum + count, 0)
}

interface WarehouseState {
  items: WarehouseItemEntry[]
  stones: CompositionStones
  loaded: boolean
  busy: boolean
  // Surfaces a client-side "Warehouse is full" block — deposits are always a
  // deliberate, already-in-progress action (unlike a kill-drop roll), so a plain
  // blocked message is enough for this first pass, no pending-decision modal.
  fullMessage: string | null
  loadWarehouseItems: (characterId: string) => Promise<void>
  hydrateStones: (stones: CompositionStones) => void
  occupiedSlotCount: () => number
  depositItem: (characterId: string, itemId: string) => Promise<DepositItemResult>
  withdrawItem: (characterId: string, templateId: string, compositionLevel: number) => Promise<WithdrawItemResult>
  depositStone: (characterId: string, tier: number, amount: number) => Promise<TransferStoneResult>
  withdrawStone: (characterId: string, tier: number, amount: number) => Promise<TransferStoneResult>
  depositCurrency: (characterId: string, currency: Currency, amount: number) => Promise<TransferCurrencyResult>
  withdrawCurrency: (characterId: string, currency: Currency, amount: number) => Promise<TransferCurrencyResult>
  clearFullMessage: () => void
}

export const useWarehouseStore = create<WarehouseState>((set, get) => ({
  items: [],
  stones: DEFAULT_STONES,
  loaded: false,
  busy: false,
  fullMessage: null,

  loadWarehouseItems: async (characterId) => {
    const { data, error } = await supabase.from('warehouse_items').select('*').eq('character_id', characterId)

    if (error) {
      console.error('Failed to load warehouse items', error)
      return
    }

    set({ items: (data ?? []) as WarehouseItemEntry[], loaded: true })
  },

  hydrateStones: (stones) => set({ stones }),

  occupiedSlotCount: () => {
    const { items, stones } = get()
    return items.length + totalStoneCount(stones)
  },

  depositItem: async (characterId, itemId) => {
    const sourceItem = useInventoryStore.getState().items.find((item) => item.id === itemId)
    const existingEntry = sourceItem
      ? get().items.find(
          (entry) => entry.template_id === sourceItem.template_id && entry.composition_level === sourceItem.composition_level,
        )
      : undefined
    const wouldNeedNewSlot = !existingEntry

    if (wouldNeedNewSlot && get().occupiedSlotCount() >= WAREHOUSE_SLOT_CAP) {
      set({ fullMessage: 'Warehouse is full.' })
      return { ok: false }
    }

    set({ busy: true, fullMessage: null })
    const { data, error } = await supabase.rpc('deposit_item', { item_id: itemId })
    set({ busy: false })

    if (error) {
      console.error('Deposit item call failed', error)
      return { ok: false }
    }

    const result = data as DepositItemResult

    if (result.ok && typeof result.template_id === 'string' && typeof result.composition_level === 'number') {
      useInventoryStore.getState().removeItems([itemId])
      set((state) => {
        const idx = state.items.findIndex(
          (entry) => entry.template_id === result.template_id && entry.composition_level === result.composition_level,
        )
        if (idx === -1) {
          return {
            items: [
              ...state.items,
              {
                id: `${characterId}:${result.template_id}:${result.composition_level}`,
                template_id: result.template_id!,
                composition_level: result.composition_level!,
                count: result.count!,
              },
            ],
          }
        }
        const next = [...state.items]
        next[idx] = { ...next[idx], count: result.count! }
        return { items: next }
      })
    }

    return result
  },

  withdrawItem: async (characterId, templateId, compositionLevel) => {
    if (occupiedSlotCount(useInventoryStore.getState().items) >= INVENTORY_SLOT_CAP) {
      return { ok: false, error: 'inventory_full' }
    }

    set({ busy: true })
    const { data, error } = await supabase.rpc('withdraw_item', {
      character_id: characterId,
      template_id: templateId,
      composition_level: compositionLevel,
    })
    set({ busy: false })

    if (error) {
      console.error('Withdraw item call failed', error)
      return { ok: false }
    }

    const result = data as WithdrawItemResult

    if (result.ok && result.item) {
      useInventoryStore.getState().addItem(result.item)
      set((state) => {
        if (!result.warehouse_count || result.warehouse_count <= 0) {
          return {
            items: state.items.filter(
              (entry) => !(entry.template_id === templateId && entry.composition_level === compositionLevel),
            ),
          }
        }
        return {
          items: state.items.map((entry) =>
            entry.template_id === templateId && entry.composition_level === compositionLevel
              ? { ...entry, count: result.warehouse_count! }
              : entry,
          ),
        }
      })
    }

    return result
  },

  depositStone: async (characterId, tier, amount) => {
    if (get().occupiedSlotCount() + amount > WAREHOUSE_SLOT_CAP) {
      set({ fullMessage: 'Warehouse is full.' })
      return { ok: false }
    }

    set({ busy: true, fullMessage: null })
    const { data, error } = await supabase.rpc('transfer_stone', {
      character_id: characterId,
      tier,
      amount,
      direction: 'deposit',
    })
    set({ busy: false })

    if (error) {
      console.error('Deposit stone call failed', error)
      return { ok: false }
    }

    const result = data as TransferStoneResult
    if (result.ok && result.stones && result.warehouse_stones) {
      useCompositionStore.getState().setStones(result.stones)
      set({ stones: result.warehouse_stones })
    }
    return result
  },

  withdrawStone: async (characterId, tier, amount) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('transfer_stone', {
      character_id: characterId,
      tier,
      amount,
      direction: 'withdraw',
    })
    set({ busy: false })

    if (error) {
      console.error('Withdraw stone call failed', error)
      return { ok: false }
    }

    const result = data as TransferStoneResult
    if (result.ok && result.stones && result.warehouse_stones) {
      useCompositionStore.getState().setStones(result.stones)
      set({ stones: result.warehouse_stones })
    }
    return result
  },

  depositCurrency: async (characterId, currency, amount) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('transfer_currency', {
      character_id: characterId,
      currency,
      amount,
      direction: 'deposit',
    })
    set({ busy: false })

    if (error) {
      console.error('Deposit currency call failed', error)
      return { ok: false }
    }

    return applyCurrencyResult(currency, data as TransferCurrencyResult)
  },

  withdrawCurrency: async (characterId, currency, amount) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('transfer_currency', {
      character_id: characterId,
      currency,
      amount,
      direction: 'withdraw',
    })
    set({ busy: false })

    if (error) {
      console.error('Withdraw currency call failed', error)
      return { ok: false }
    }

    return applyCurrencyResult(currency, data as TransferCurrencyResult)
  },

  clearFullMessage: () => set({ fullMessage: null }),
}))

function applyCurrencyResult(currency: Currency, result: TransferCurrencyResult): TransferCurrencyResult {
  if (!result.ok || typeof result.character_balance !== 'number' || typeof result.bank_balance !== 'number') {
    return result
  }

  if (currency === 'gold') {
    useProgressionStore.getState().setGold(result.character_balance)
    usePlayerRecordStore.getState().setBankBalances({ bankGold: result.bank_balance })
  } else if (currency === 'meteors') {
    useCurrencyStore.getState().setMeteors(result.character_balance)
    usePlayerRecordStore.getState().setBankBalances({ bankMeteors: result.bank_balance })
  } else {
    useCurrencyStore.getState().setDragonballs(result.character_balance)
    usePlayerRecordStore.getState().setBankBalances({ bankDragonballs: result.bank_balance })
  }

  return result
}
