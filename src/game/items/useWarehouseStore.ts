import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useCompositionStore, type CompositionStones } from './useCompositionStore'
import { type GearSlotType } from './forgeCosts'
import { useInventoryStore, occupiedSlotCount, INVENTORY_SLOT_CAP, type ItemInstance } from './useInventoryStore'

type BankCurrencyType = 'meteor' | 'dragonball'

interface BankItemResult {
  ok: boolean
  error?: 'invalid_currency' | 'invalid_direction' | 'invalid_amount' | 'not_found' | 'not_owner' | 'not_enough_balance'
  count?: number
  bank_count?: number
}

interface BankStoneItemResult {
  ok: boolean
  error?: 'invalid_tier' | 'invalid_direction' | 'invalid_amount' | 'not_found' | 'not_owner' | 'not_enough_stones'
  stones?: CompositionStones
  stones_banked?: CompositionStones
}

interface DepositItemToStorageResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner' | 'already_in_bank'
  item_id?: string
}

interface WithdrawItemFromStorageResult {
  ok: boolean
  // 'inventory_full' is a client-only synthetic error, same convention as
  // this codebase's other client-side cap pre-checks.
  error?: 'item_not_found' | 'not_owner' | 'not_in_bank' | 'invalid_recipient' | 'inventory_full'
  item_id?: string
}

// Bank Storage (Bank tab rework, 2026-08-03, confirmed with the user) —
// fully account-wide now, not per-character: any of an account's 5
// characters can deposit into or withdraw from the same shared Storage and
// the same points pools. Its own 40-slot cap (WAREHOUSE_SLOT_CAP), mirroring
// Inventory's own INVENTORY_SLOT_CAP.
//
// The dead legacy "fungible token" system (warehouse_items, deposit_item/
// withdraw_item) has been removed entirely — see
// supabase/migrations/20260803080000_bank_account_wide.sql. What's left is
// two genuinely different mechanics per bankable type, both real, both
// still live: physical storage (deposit_item_to_storage/bank_currency_item/
// bank_stone_item — identity/tier preserved, no points) and liquidation
// (transfer_stone/deposit_item_as_composition/withdraw_gear_composition —
// converts into a fungible points pool). See CLAUDE.md's Bank tab section.
export const WAREHOUSE_SLOT_CAP = 40

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

// deposit_item_as_composition / withdraw_gear_composition — a second,
// independent gear liquidation path alongside deposit_item_to_storage: no
// physical storage slot, points go into a per-slot-type pool instead. See
// forgeCosts.ts's GearCompositionPoints.
interface DepositItemAsCompositionResult {
  ok: boolean
  error?: 'item_not_found' | 'not_owner' | 'unsupported_slot_type' | 'no_points_contributed'
  slot_type?: GearSlotType
  points_gained?: number
  gear_composition_points?: Record<GearSlotType, number>
}

interface WithdrawGearCompositionResult {
  ok: boolean
  error?: 'not_owner' | 'invalid_request' | 'template_not_found' | 'unsupported_slot_type' | 'not_enough_points' | 'inventory_full'
  item?: ItemInstance
  slot_type?: GearSlotType
  gear_composition_points?: Record<GearSlotType, number>
}

interface WarehouseState {
  // Account-wide banked gear (item_instances where location='bank', across
  // every character on the account — not just the active one). Populated by
  // loadBankItems, patched locally on each successful deposit/withdraw
  // rather than refetched. Independent of useInventoryStore.items, which
  // stays scoped to the active character's own items (including that
  // character's own banked ones, simply filtered out of view there) — the
  // two collections deliberately overlap for the active character rather
  // than needing to stay deduplicated against each other.
  bankedItems: ItemInstance[]
  loaded: boolean
  busy: boolean
  // Surfaces a client-side "Storage is full" block — deposits are always a
  // deliberate, already-in-progress action (unlike a kill-drop roll), so a plain
  // blocked message is enough for this first pass, no pending-decision modal.
  fullMessage: string | null
  loadBankItems: (accountId: string) => Promise<void>
  occupiedSlotCount: () => number
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
  depositItemToStorage: (itemId: string) => Promise<DepositItemToStorageResult>
  // characterId is always the active character (the recipient claiming the
  // item) — no character-picker UI exists for this pass, matching the
  // confirmed plan scope.
  withdrawItemFromStorage: (itemId: string, characterId: string) => Promise<WithdrawItemFromStorageResult>
  depositCurrencyItem: (characterId: string, currencyType: BankCurrencyType, amount: number) => Promise<BankItemResult>
  withdrawCurrencyItem: (characterId: string, currencyType: BankCurrencyType, amount: number) => Promise<BankItemResult>
  depositStoneItem: (characterId: string, tier: number, amount: number) => Promise<BankStoneItemResult>
  withdrawStoneItem: (characterId: string, tier: number, amount: number) => Promise<BankStoneItemResult>
}

export const useWarehouseStore = create<WarehouseState>((set, get) => ({
  bankedItems: [],
  loaded: false,
  busy: false,
  fullMessage: null,

  loadBankItems: async (accountId) => {
    const { data: characterRows, error: characterError } = await supabase
      .from('characters')
      .select('id')
      .eq('account_id', accountId)

    if (characterError) {
      console.error('Failed to load account characters for Bank Storage', characterError)
      return
    }

    const characterIds = (characterRows ?? []).map((row) => row.id)
    if (characterIds.length === 0) {
      set({ bankedItems: [], loaded: true })
      return
    }

    const { data, error } = await supabase
      .from('item_instances')
      .select('*')
      .in('owner_id', characterIds)
      .eq('location', 'bank')

    if (error) {
      console.error('Failed to load Bank Storage items', error)
      return
    }

    set({ bankedItems: (data ?? []) as ItemInstance[], loaded: true })
  },

  // Only gear tiles + banked Meteor/DragonBall units count toward Storage's
  // 40-slot cap — banked stones live as squares now (see BankSquares.tsx),
  // not grid tiles, and points pools are a fungible balance, not a physical
  // stack of tiles, same as currency isn't slot-based.
  occupiedSlotCount: () => {
    const player = usePlayerRecordStore.getState()
    return get().bankedItems.length + player.meteorBankCount + player.dragonballBankCount
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
      usePlayerRecordStore.getState().setGearCompositionPoints(result.gear_composition_points)
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
      usePlayerRecordStore.getState().setGearCompositionPoints(result.gear_composition_points)
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
      usePlayerRecordStore.getState().setWarehousePoints(result.warehouse_points)
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
      usePlayerRecordStore.getState().setWarehousePoints(result.warehouse_points)
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

  depositItemToStorage: async (itemId) => {
    if (get().occupiedSlotCount() >= WAREHOUSE_SLOT_CAP) {
      set({ fullMessage: 'Storage is full.' })
      return { ok: false }
    }

    const sourceItem = useInventoryStore.getState().items.find((item) => item.id === itemId)

    set({ busy: true, fullMessage: null })
    const { data, error } = await supabase.rpc('deposit_item_to_storage', { item_id: itemId })
    set({ busy: false })

    if (error) {
      console.error('Deposit item to storage call failed', error)
      return { ok: false }
    }

    const result = data as DepositItemToStorageResult
    if (result.ok) {
      useInventoryStore.getState().setItemLocation(itemId, 'bank')
      if (sourceItem) {
        set((state) => ({ bankedItems: [...state.bankedItems, { ...sourceItem, location: 'bank' }] }))
      }
    }
    return result
  },

  withdrawItemFromStorage: async (itemId, characterId) => {
    if (occupiedSlotCount(useInventoryStore.getState().items) >= INVENTORY_SLOT_CAP) {
      return { ok: false, error: 'inventory_full' }
    }

    const sourceItem = get().bankedItems.find((item) => item.id === itemId)

    set({ busy: true })
    const { data, error } = await supabase.rpc('withdraw_item_from_storage', {
      item_id: itemId,
      p_character_id: characterId,
    })
    set({ busy: false })

    if (error) {
      console.error('Withdraw item from storage call failed', error)
      return { ok: false }
    }

    const result = data as WithdrawItemFromStorageResult
    if (result.ok) {
      set((state) => ({ bankedItems: state.bankedItems.filter((item) => item.id !== itemId) }))
      if (sourceItem) {
        useInventoryStore.getState().addItem({ ...sourceItem, location: 'inventory', owner_id: characterId })
      }
    }
    return result
  },

  depositCurrencyItem: async (characterId, currencyType, amount) => {
    if (get().occupiedSlotCount() + amount > WAREHOUSE_SLOT_CAP) {
      set({ fullMessage: 'Storage is full.' })
      return { ok: false }
    }

    set({ busy: true, fullMessage: null })
    const { data, error } = await supabase.rpc('bank_currency_item', {
      character_id: characterId,
      currency_type: currencyType,
      direction: 'deposit',
      amount,
    })
    set({ busy: false })

    if (error) {
      console.error('Deposit currency item call failed', error)
      return { ok: false }
    }

    return applyBankCurrencyItemResult(currencyType, data as BankItemResult)
  },

  withdrawCurrencyItem: async (characterId, currencyType, amount) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('bank_currency_item', {
      character_id: characterId,
      currency_type: currencyType,
      direction: 'withdraw',
      amount,
    })
    set({ busy: false })

    if (error) {
      console.error('Withdraw currency item call failed', error)
      return { ok: false }
    }

    return applyBankCurrencyItemResult(currencyType, data as BankItemResult)
  },

  depositStoneItem: async (characterId, tier, amount) => {
    set({ busy: true, fullMessage: null })
    const { data, error } = await supabase.rpc('bank_stone_item', {
      character_id: characterId,
      tier,
      direction: 'deposit',
      amount,
    })
    set({ busy: false })

    if (error) {
      console.error('Deposit stone item call failed', error)
      return { ok: false }
    }

    const result = data as BankStoneItemResult
    if (result.ok && result.stones && result.stones_banked) {
      useCompositionStore.getState().setStones(result.stones)
      usePlayerRecordStore.getState().setStonesBanked(result.stones_banked)
    }
    return result
  },

  withdrawStoneItem: async (characterId, tier, amount) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('bank_stone_item', {
      character_id: characterId,
      tier,
      direction: 'withdraw',
      amount,
    })
    set({ busy: false })

    if (error) {
      console.error('Withdraw stone item call failed', error)
      return { ok: false }
    }

    const result = data as BankStoneItemResult
    if (result.ok && result.stones && result.stones_banked) {
      useCompositionStore.getState().setStones(result.stones)
      usePlayerRecordStore.getState().setStonesBanked(result.stones_banked)
    }
    return result
  },
}))

function applyBankCurrencyItemResult(currencyType: BankCurrencyType, result: BankItemResult): BankItemResult {
  if (!result.ok || typeof result.count !== 'number' || typeof result.bank_count !== 'number') {
    return result
  }

  if (currencyType === 'meteor') {
    useCurrencyStore.getState().setMeteors(result.count)
    usePlayerRecordStore.getState().setMeteorBankCount(result.bank_count)
  } else {
    useCurrencyStore.getState().setDragonballs(result.count)
    usePlayerRecordStore.getState().setDragonballBankCount(result.bank_count)
  }

  return result
}

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
