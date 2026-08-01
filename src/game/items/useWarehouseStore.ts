import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useCompositionStore, type CompositionStones } from './useCompositionStore'
import { DEFAULT_GEAR_COMPOSITION_POINTS, type GearCompositionPoints, type GearSlotType } from './forgeCosts'
import { useInventoryStore, occupiedSlotCount, INVENTORY_SLOT_CAP, type ItemInstance } from './useInventoryStore'

// Warehouse: per-character storage for gear tokens and Composition stones (its
// own 40-slot cap, exactly mirroring Inventory's INVENTORY_SLOT_CAP), plus
// account-wide currency (gold/meteors/dragonballs) shared across every character
// on the account — see CLAUDE.md's Accounts & Characters section.
//
// Stones and composed gear both liquidate into a single "warehouse points"
// balance on deposit (same point-value formula Composition feeding already
// uses), rather than being stored as exact tier-tagged tokens. Withdrawing a
// stone (or a gear item at a chosen composition tier) spends points at that
// tier's value — deposited stuff is fungible by point value, not just within
// its own tier. Points aren't slot-based (same as currency isn't).
export const WAREHOUSE_SLOT_CAP = 40

// One row per template_id — fully fungible once deposited (identity-destroying
// bank rule; any composition value was cashed into points at deposit time), so
// it occupies exactly one Warehouse slot regardless of count, same as one arrow
// stack occupying one Inventory slot regardless of its count.
export interface WarehouseItemEntry {
  id: string
  template_id: string
  count: number
}

type Currency = 'gold' | 'meteors' | 'dragonballs'

interface TransferStoneResult {
  ok: boolean
  error?: 'invalid_direction' | 'invalid_request' | 'not_owner' | 'not_enough_stones' | 'not_enough_points'
  stones?: CompositionStones
  warehouse_points?: number
}

interface TransferCurrencyResult {
  ok: boolean
  error?: 'invalid_currency' | 'invalid_direction' | 'invalid_amount' | 'not_owner' | 'not_enough_balance'
  character_balance?: number
  bank_balance?: number
  // Set only for meteors/dragonballs — a deposit that couldn't be covered by
  // loose units alone auto-unbundles however many Scrolls it needed (see
  // migration 20260731090000_smart_scroll_currency_deposit.sql), so the
  // client's Scroll count can change too, not just the loose-unit count.
  character_scroll_count?: number
}

interface DepositItemResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner'
  template_id?: string
  count?: number
  points_gained?: number
  warehouse_points?: number
}

interface WithdrawItemResult {
  ok: boolean
  // 'inventory_full' is a client-only synthetic error — never returned by the RPC
  // itself, added before the call even fires (mirrors grantItemDrop's own
  // client-side cap check for the same 40-slot Inventory limit).
  error?: 'not_owner' | 'not_found' | 'invalid_request' | 'not_enough_points' | 'inventory_full'
  item?: ItemInstance
  warehouse_count?: number
  warehouse_points?: number
}

// deposit_item_as_composition / withdraw_gear_composition (stage 4) — a second,
// independent gear deposit path alongside deposit_item/withdraw_item above: no
// warehouse_items token, points go into a per-slot-type pool instead of the
// shared warehouse_points balance. See forgeCosts.ts's GearCompositionPoints.
interface DepositItemAsCompositionResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner' | 'unsupported_slot_type' | 'no_points_contributed'
  slot_type?: GearSlotType
  points_gained?: number
  gear_composition_points?: GearCompositionPoints
}

interface WithdrawGearCompositionResult {
  ok: boolean
  error?: 'not_owner' | 'invalid_request' | 'template_not_found' | 'unsupported_slot_type' | 'not_enough_points' | 'inventory_full'
  item?: ItemInstance
  slot_type?: GearSlotType
  gear_composition_points?: GearCompositionPoints
}

interface WarehouseState {
  items: WarehouseItemEntry[]
  points: number
  gearCompositionPoints: GearCompositionPoints
  loaded: boolean
  busy: boolean
  // Surfaces a client-side "Warehouse is full" block — deposits are always a
  // deliberate, already-in-progress action (unlike a kill-drop roll), so a plain
  // blocked message is enough for this first pass, no pending-decision modal.
  fullMessage: string | null
  loadWarehouseItems: (characterId: string) => Promise<void>
  hydratePoints: (points: number) => void
  hydrateGearCompositionPoints: (points: GearCompositionPoints) => void
  occupiedSlotCount: () => number
  depositItem: (characterId: string, itemId: string) => Promise<DepositItemResult>
  withdrawItem: (characterId: string, templateId: string, compositionLevel: number) => Promise<WithdrawItemResult>
  depositItemAsComposition: (itemId: string) => Promise<DepositItemAsCompositionResult>
  withdrawGearComposition: (
    characterId: string,
    templateId: string,
    compositionLevel: number,
  ) => Promise<WithdrawGearCompositionResult>
  depositStone: (characterId: string, tier: number, amount: number) => Promise<TransferStoneResult>
  withdrawStone: (characterId: string, tier: number, amount: number) => Promise<TransferStoneResult>
  depositCurrency: (characterId: string, currency: Currency, amount: number) => Promise<TransferCurrencyResult>
  withdrawCurrency: (characterId: string, currency: Currency, amount: number) => Promise<TransferCurrencyResult>
  clearFullMessage: () => void
}

export const useWarehouseStore = create<WarehouseState>((set, get) => ({
  items: [],
  points: 0,
  gearCompositionPoints: DEFAULT_GEAR_COMPOSITION_POINTS,
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

  hydratePoints: (points) => set({ points }),
  hydrateGearCompositionPoints: (points) => set({ gearCompositionPoints: points }),

  // Only gear tokens count toward the Warehouse's 40-slot cap — points are a
  // fungible balance, same as currency, not a physical stack of tiles.
  occupiedSlotCount: () => get().items.length,

  depositItem: async (characterId, itemId) => {
    const sourceItem = useInventoryStore.getState().items.find((item) => item.id === itemId)
    const existingEntry = sourceItem ? get().items.find((entry) => entry.template_id === sourceItem.template_id) : undefined
    const wouldNeedNewSlot = !existingEntry

    if (wouldNeedNewSlot && get().occupiedSlotCount() >= WAREHOUSE_SLOT_CAP) {
      set({ fullMessage: 'Storage is full.' })
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

    if (result.ok && typeof result.template_id === 'string') {
      useInventoryStore.getState().removeItems([itemId])
      set((state) => {
        const idx = state.items.findIndex((entry) => entry.template_id === result.template_id)
        const nextItems =
          idx === -1
            ? [
                ...state.items,
                { id: `${characterId}:${result.template_id}`, template_id: result.template_id!, count: result.count! },
              ]
            : state.items.map((entry, i) => (i === idx ? { ...entry, count: result.count! } : entry))
        return {
          items: nextItems,
          points: typeof result.warehouse_points === 'number' ? result.warehouse_points : state.points,
        }
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
      set((state) => ({
        items:
          !result.warehouse_count || result.warehouse_count <= 0
            ? state.items.filter((entry) => entry.template_id !== templateId)
            : state.items.map((entry) => (entry.template_id === templateId ? { ...entry, count: result.warehouse_count! } : entry)),
        points: typeof result.warehouse_points === 'number' ? result.warehouse_points : state.points,
      }))
    }

    return result
  },

  depositItemAsComposition: async (itemId) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('deposit_item_as_composition', { item_id: itemId })
    set({ busy: false })

    if (error) {
      console.error('Deposit item as composition call failed', error)
      return { ok: false }
    }

    const result = data as DepositItemAsCompositionResult

    if (result.ok && result.gear_composition_points) {
      useInventoryStore.getState().removeItems([itemId])
      set({ gearCompositionPoints: result.gear_composition_points })
    }

    return result
  },

  withdrawGearComposition: async (characterId, templateId, compositionLevel) => {
    if (occupiedSlotCount(useInventoryStore.getState().items) >= INVENTORY_SLOT_CAP) {
      return { ok: false, error: 'inventory_full' }
    }

    set({ busy: true })
    const { data, error } = await supabase.rpc('withdraw_gear_composition', {
      character_id: characterId,
      template_id: templateId,
      composition_level: compositionLevel,
    })
    set({ busy: false })

    if (error) {
      console.error('Withdraw gear composition call failed', error)
      return { ok: false }
    }

    const result = data as WithdrawGearCompositionResult

    if (result.ok && result.item && result.gear_composition_points) {
      useInventoryStore.getState().addItem(result.item)
      set({ gearCompositionPoints: result.gear_composition_points })
    }

    return result
  },

  depositStone: async (characterId, tier, amount) => {
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
    if (result.ok && result.stones && typeof result.warehouse_points === 'number') {
      useCompositionStore.getState().setStones(result.stones)
      set({ points: result.warehouse_points })
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
    if (result.ok && result.stones && typeof result.warehouse_points === 'number') {
      useCompositionStore.getState().setStones(result.stones)
      set({ points: result.warehouse_points })
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
    if (typeof result.character_scroll_count === 'number') {
      useCurrencyStore.getState().setMeteorScrolls(result.character_scroll_count)
    }
    usePlayerRecordStore.getState().setBankBalances({ bankMeteors: result.bank_balance })
  } else {
    useCurrencyStore.getState().setDragonballs(result.character_balance)
    if (typeof result.character_scroll_count === 'number') {
      useCurrencyStore.getState().setDragonballScrolls(result.character_scroll_count)
    }
    usePlayerRecordStore.getState().setBankBalances({ bankDragonballs: result.bank_balance })
  }

  return result
}
