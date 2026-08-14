import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useCompositionStore, type CompositionStones } from './useCompositionStore'
import { useGemStore } from './useGemStore'
import type { GemCounts, GemTier, GemTypeId } from './gemTypes'
import { type GearSlotType } from './forgeCosts'
import { useInventoryStore, occupiedSlotCount, INVENTORY_SLOT_CAP, type ItemInstance } from './useInventoryStore'

type BankCurrencyType = 'comet' | 'fallen_star'

interface BankItemResult {
  ok: boolean
  error?: 'invalid_currency' | 'invalid_direction' | 'invalid_amount' | 'not_found' | 'not_owner' | 'not_enough_balance'
  count?: number
  bank_count?: number
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
// the same points pools. Its own 40-slot cap (BANK_SLOT_CAP), mirroring
// Inventory's own INVENTORY_SLOT_CAP.
//
// The dead legacy "fungible token" system (warehouse_items, deposit_item/
// withdraw_item) has been removed entirely — see
// supabase/migrations/20260803080000_bank_account_wide.sql. Two genuinely
// different mechanics remain per bankable type: physical storage
// (deposit_item_to_storage — identity/tier preserved, no points) and
// liquidation (transfer_stone/deposit_item_as_composition/
// withdraw_gear_composition — converts into a fungible points pool). See
// CLAUDE.md's Bank tab section. Physical storage for Comets/Fallen
// Stars/Stones (bank_currency_item/bank_stone_item) was retired from the UI
// 2026-08-07 (confirmed with the user) — only Withdraw of already-banked
// Comet/Fallen Star units survives (withdrawCurrencyItem, still used by
// BankGrid); stones moved entirely onto the points system.
export const BANK_SLOT_CAP = 40

type Currency = 'gold' | 'comets' | 'fallen_stars'

interface TransferStoneResult {
  ok: boolean
  error?: 'invalid_direction' | 'invalid_request' | 'not_owner' | 'not_enough_stones' | 'not_enough_points'
  stones?: CompositionStones
  bank_points?: number
}

// transfer_gem (2026-08-09) — symmetric per-unit deposit/withdraw between a
// character's `gems` and the account's `gems_banked`, mirroring
// transfer_currency's shape but without Scroll-bundling (gems have no
// Scroll concept).
interface TransferGemResult {
  ok: boolean
  error?: 'invalid_gem' | 'invalid_tier' | 'invalid_direction' | 'invalid_amount' | 'not_owner' | 'not_enough_balance' | 'not_enough_room'
  gems?: GemCounts
  gems_banked?: GemCounts
  occupied?: number
  max_withdrawable?: number
}

// open_comet_box (2026-08-25) — consumes 1 Comet Box (characters.comet_box_count)
// and grants a flat 100 Comets straight into the account's Bank balance
// (players.bank_comets), a cross-store mutation (character count + account
// balance) same shape as withdrawCurrencyItem below, so it lives here rather
// than on useCurrencyStore alongside the count itself.
interface OpenCometBoxResult {
  ok: boolean
  error?: 'not_owner' | 'not_enough_boxes'
  comet_box_count?: number
  bank_comets?: number
}

interface TransferCurrencyResult {
  ok: boolean
  // 'not_enough_room' (2026-08-07) — withdrawing comets/fallen_stars is
  // capped at however many actually fit as Inventory tiles (each withdrawn
  // unit becomes its own non-stacking tile, same as a claimed one) —
  // reported by the user: withdrawing more than fit left "invisible" comets
  // that existed server-side but had nowhere to render. Gold is unaffected.
  error?: 'invalid_currency' | 'invalid_direction' | 'invalid_amount' | 'not_owner' | 'not_enough_balance' | 'not_enough_room'
  character_balance?: number
  bank_balance?: number
  max_withdrawable?: number
  // Set only for comets/fallen_stars — a deposit that couldn't be covered by
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

interface BankState {
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
  // Appends a freshly-stored item without a refetch — used by
  // useLootHoldingStore's storeGear (2026-08-07), the Loot Holding "Store"
  // action, which inserts straight into item_instances with location='bank'
  // via a dedicated RPC rather than going through depositItemToStorage
  // (there's no existing owned item to flip location on — the Loot Holding
  // entry isn't a real item_instances row yet).
  addBankedItem: (item: ItemInstance) => void
  depositItemAsComposition: (itemId: string) => Promise<DepositItemAsCompositionResult>
  withdrawGearComposition: (
    characterId: string,
    templateId: string,
    compositionLevel: number,
  ) => Promise<WithdrawGearCompositionResult>
  depositStone: (characterId: string, tier: number, amount: number) => Promise<TransferStoneResult>
  withdrawStone: (characterId: string, tier: number, amount: number) => Promise<TransferStoneResult>
  depositCurrency: (characterId: string, currency: Currency, amount: number) => Promise<TransferCurrencyResult>
  // forceIndividual (2026-08-14) — Comets/Fallen Stars only, withdraw-only:
  // when true, every requested unit lands as a loose tile with no
  // auto-bundling into Scrolls (the Account Bank popup's "Individual" mode).
  // Omitted/false preserves the existing auto-bundle behavior — "Scroll"
  // mode just requests an exact multiple of 10, which already bundles into
  // pure Scrolls with no remainder.
  withdrawCurrency: (characterId: string, currency: Currency, amount: number, forceIndividual?: boolean) => Promise<TransferCurrencyResult>
  // Gems (2026-08-09) — physical, non-stacking Inventory tiles now, banked
  // the same symmetric per-unit way as Comets/Fallen Stars (transfer_gem),
  // not the points-liquidation way Stones use (gems have no points concept).
  depositGem: (characterId: string, gemId: GemTypeId, tier: GemTier, amount: number) => Promise<TransferGemResult>
  withdrawGem: (characterId: string, gemId: GemTypeId, tier: GemTier, amount: number) => Promise<TransferGemResult>
  clearFullMessage: () => void
  depositItemToStorage: (itemId: string) => Promise<DepositItemToStorageResult>
  // characterId is always the active character (the recipient claiming the
  // item) — no character-picker UI exists for this pass, matching the
  // confirmed plan scope.
  withdrawItemFromStorage: (itemId: string, characterId: string) => Promise<WithdrawItemFromStorageResult>
  // Deposit into physical Comet/Fallen Star Bank Storage (bank_currency_item)
  // was retired 2026-08-07 (confirmed with the user) — Withdraw stays so any
  // already-banked physical units are still reachable from BankGrid.
  withdrawCurrencyItem: (characterId: string, currencyType: BankCurrencyType, amount: number) => Promise<BankItemResult>
  // Comet Box "Open" (2026-08-25) — see OpenCometBoxResult above.
  openCometBox: (characterId: string) => Promise<OpenCometBoxResult>
}

export const useBankStore = create<BankState>((set, get) => ({
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

  // Only gear tiles + banked Comet/Fallen Star units count toward Storage's
  // 40-slot cap — banked stones live as squares now (see BankSquares.tsx),
  // not grid tiles, and points pools are a fungible balance, not a physical
  // stack of tiles, same as currency isn't slot-based.
  occupiedSlotCount: () => {
    const player = usePlayerRecordStore.getState()
    return get().bankedItems.length + player.cometBankCount + player.fallenStarBankCount
  },

  addBankedItem: (item) => set((state) => ({ bankedItems: [...state.bankedItems, item] })),

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
    if (result.ok && result.stones && typeof result.bank_points === 'number') {
      useCompositionStore.getState().setStones(result.stones)
      usePlayerRecordStore.getState().setBankPoints(result.bank_points)
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
    if (result.ok && result.stones && typeof result.bank_points === 'number') {
      useCompositionStore.getState().setStones(result.stones)
      usePlayerRecordStore.getState().setBankPoints(result.bank_points)
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

  withdrawCurrency: async (characterId, currency, amount, forceIndividual) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('transfer_currency', {
      character_id: characterId,
      currency,
      amount,
      direction: 'withdraw',
      force_individual: forceIndividual ?? false,
    })
    set({ busy: false })

    if (error) {
      console.error('Withdraw currency call failed', error)
      return { ok: false }
    }

    return applyCurrencyResult(currency, data as TransferCurrencyResult)
  },

  depositGem: async (characterId, gemId, tier, amount) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('transfer_gem', {
      character_id: characterId,
      gem_id: gemId,
      tier,
      amount,
      direction: 'deposit',
    })
    set({ busy: false })

    if (error) {
      console.error('Deposit gem call failed', error)
      return { ok: false }
    }

    return applyGemResult(data as TransferGemResult)
  },

  withdrawGem: async (characterId, gemId, tier, amount) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('transfer_gem', {
      character_id: characterId,
      gem_id: gemId,
      tier,
      amount,
      direction: 'withdraw',
    })
    set({ busy: false })

    if (error) {
      console.error('Withdraw gem call failed', error)
      return { ok: false }
    }

    return applyGemResult(data as TransferGemResult)
  },

  clearFullMessage: () => set({ fullMessage: null }),

  depositItemToStorage: async (itemId) => {
    if (get().occupiedSlotCount() >= BANK_SLOT_CAP) {
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

  openCometBox: async (characterId) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('open_comet_box', { p_character_id: characterId })
    set({ busy: false })

    if (error) {
      console.error('Open comet box call failed', error)
      return { ok: false }
    }

    const result = data as OpenCometBoxResult

    if (result.ok && typeof result.comet_box_count === 'number' && typeof result.bank_comets === 'number') {
      useCurrencyStore.getState().setCometBoxes(result.comet_box_count)
      usePlayerRecordStore.getState().setBankBalances({ bankComets: result.bank_comets })
    }

    return result
  },

}))

function applyBankCurrencyItemResult(currencyType: BankCurrencyType, result: BankItemResult): BankItemResult {
  if (!result.ok || typeof result.count !== 'number' || typeof result.bank_count !== 'number') {
    return result
  }

  if (currencyType === 'comet') {
    useCurrencyStore.getState().setComets(result.count)
    usePlayerRecordStore.getState().setCometBankCount(result.bank_count)
  } else {
    useCurrencyStore.getState().setFallenStars(result.count)
    usePlayerRecordStore.getState().setFallenStarBankCount(result.bank_count)
  }

  return result
}

function applyGemResult(result: TransferGemResult): TransferGemResult {
  if (result.ok && result.gems && result.gems_banked) {
    useGemStore.getState().setGems(result.gems)
    usePlayerRecordStore.getState().setGemsBanked(result.gems_banked)
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
  } else if (currency === 'comets') {
    useCurrencyStore.getState().setComets(result.character_balance)
    if (typeof result.character_scroll_count === 'number') {
      useCurrencyStore.getState().setCometScrolls(result.character_scroll_count)
    }
    usePlayerRecordStore.getState().setBankBalances({ bankComets: result.bank_balance })
  } else {
    useCurrencyStore.getState().setFallenStars(result.character_balance)
    if (typeof result.character_scroll_count === 'number') {
      useCurrencyStore.getState().setFallenStarScrolls(result.character_scroll_count)
    }
    usePlayerRecordStore.getState().setBankBalances({ bankFallenStars: result.bank_balance })
  }

  return result
}
