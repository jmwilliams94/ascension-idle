import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useCompositionStore, type CompositionStones } from '../items/useCompositionStore'
import { useGemStore } from '../items/useGemStore'
import type { GemCounts } from '../items/gemTypes'

export const LUCKY_TICKET_ITEM_COST = 1

// LuckyLad's ticket draw — Stage 1 (see CLAUDE.md's Lucky section, and the
// migration's own header for the full write-up). The tab/mascot is named
// "LuckyLad" (renamed from the plain "Lucky" label, 2026-08-03, confirmed
// with the user, wording + mascot art only — TabId/route/store names are all
// unchanged). Free draw every 4 hours (lowered from 6, requested by the
// user), uncapped paid extras at a flat cost. draw() is the whole mechanic
// in one call — eligibility, the blind 9-card roll, granting the pick, and
// revealing the board all happen server-side inside draw_lucky_ticket before
// anything is returned, so there's nothing to inspect ahead of an
// irrevocable choice.
export const LUCKY_TICKET_AP_COST = 20
export const LUCKY_FREE_TICKET_COOLDOWN_MS = 4 * 60 * 60 * 1000
export const LUCKY_CARD_COUNT = 9

// Bulk draw (2026-08-22, requested by the user) — a third payment path
// alongside the free/1-ticket/20-AP single-card draw above: pay 160 AP
// (8x the single-card cost — "9 chests for the price of 8") and every one of
// the 9 cards grants a real, independent reward, all resolved and granted in
// one draw_lucky_ticket_bulk RPC call. See that migration's own header for
// why revealing them one at a time client-side afterward is still safe (all
// 9 are already decided and paid for by the time the board comes back).
export const LUCKY_BULK_AP_COST = 160

// Real art (2026-08-03), user-supplied, same trim/pad/resize-to-160
// convention as every other icon this session — all three already had real
// transparency, so no flood-fill background removal was needed this time.
const BASE_URL = import.meta.env.BASE_URL
export const LUCKYLAD_ICON_SRC = `${BASE_URL}lucky-icons/luckylad.png`
export const CHEST_CLOSED_ICON_SRC = `${BASE_URL}lucky-icons/chest-closed.png`
export const CHEST_OPEN_ICON_SRC = `${BASE_URL}lucky-icons/chest-open.png`

// Lucky rewards expansion (2026-08-09) — 'gold' is kept as a recognized kind
// for type-completeness only; pick_lucky_reward no longer rolls it (replaced
// by tiered money_bag). New kinds: money_bag (amount = Class 1-10, opens for
// gold), gem_bag (opens for 1 random Normal gem), composition_stone (amount
// = tier 1-6, credited directly), and three pre-made gear rewards.
//
// gem_tempered_<id>/gem_ascended_<id> (2026-08-13, split from the original
// generic 'gem_tempered'/'gem_ascended' kinds) — the specific gem type is now
// baked into the reward kind itself and rolled by pick_lucky_reward at the
// same time as everything else, rather than being decided separately, after
// the fact, only for whichever card was actually picked (see
// draw_lucky_ticket's old random-gem-id assignment). This means every board
// entry — won or not — now carries its real specific gem, not a placeholder
// "Tempered Gem"/"Ascended Gem" label. The original two weights were split
// evenly 4 ways across drake/ember/bastion/iris in pick_lucky_reward.
//
// comet_box (2026-08-21, requested by the user) — a flat, instant +100
// Comets, distinct from the plain 'comet' kind (+1 loose Comet). `amount` on
// this kind carries the literal grant amount (100), unlike most other kinds
// where `amount` means a tier/class index — weight matches Fallen Star's own
// (4.0, requested by the user 2026-08-23, see pick_lucky_reward's own
// comment). Reveals via the same center-screen MoneyBagRevealModal a Money
// Bag's gold/gem reveal uses (see LuckyPanel.tsx's handleOpen), not the
// inline board tile alone.
export type LuckyRewardKind =
  | 'gold'
  | 'comet'
  | 'comet_box'
  | 'fallen_star'
  | 'comet_scroll'
  | 'fallen_star_scroll'
  | 'money_bag'
  | 'gem_bag'
  | 'composition_stone'
  | 'gem_tempered_drake'
  | 'gem_tempered_ember'
  | 'gem_tempered_bastion'
  | 'gem_tempered_iris'
  | 'gem_ascended_drake'
  | 'gem_ascended_ember'
  | 'gem_ascended_bastion'
  | 'gem_ascended_iris'
  | 'gear_radiant_bow'
  | 'gear_radiant_coat'
  | 'gear_ascended_random'

export interface LuckyReward {
  kind: LuckyRewardKind
  amount: number
}

interface LuckyCharacterTotals {
  gold: number
  comet_count: number
  fallen_star_count: number
  comet_scroll_count: number
  fallen_star_scroll_count: number
  lottery_ticket_count: number
}

export interface DrawLuckyTicketResult {
  ok: boolean
  error?: 'invalid_card_index' | 'not_owner' | 'not_enough_ap' | 'not_enough_lottery_tickets' | 'not_enough_room' | 'rpc_failed'
  cost?: number
  ascension_points?: number
  next_free_ticket_at?: string | null
  board?: LuckyReward[]
  won_index?: number
  payment?: 'free' | 'ascension_points' | 'lottery_ticket'
  character?: LuckyCharacterTotals
  // Present only for item-producing kinds (money_bag/gem_bag/gear_*) — the
  // freshly-inserted item_instances row, straight from the RPC's own
  // `returning *`. Present alongside the scalar `character` totals, not
  // instead of them.
  granted_item?: ItemInstance
  // Bulk draw only (draw_lucky_ticket_bulk) — 0-9 freshly-inserted
  // item_instances rows, one per item-producing card among the 9. Mutually
  // exclusive with granted_item, which only the single-card draw returns.
  granted_items?: ItemInstance[]
  // Present only for the composition_stone/gem_tempered/gem_ascended kinds —
  // the character's full updated jsonb column, ready to hand straight to
  // useCompositionStore/useGemStore.
  composition_stones?: CompositionStones
  gems?: GemCounts
}

interface LuckyState {
  // Epoch ms the free ticket next becomes available — null means it's
  // available right now (never claimed, or the 4h window has already passed).
  nextFreeTicketAt: number | null
  busy: boolean
  hydrate: (claimedAt: string | null) => void
  // useTicket (2026-08-06, Achievements rework) — a third, independent
  // payment path alongside the free 4h cooldown and the 20-AP paid draw:
  // consumes 1 Lottery Ticket instead, bypassing both the cooldown and AP
  // entirely. See draw_lucky_ticket's own p_use_ticket parameter.
  draw: (characterId: string, cardIndex: number, useTicket?: boolean) => Promise<DrawLuckyTicketResult>
  // Bulk draw (draw_lucky_ticket_bulk) — no card index, since every one of
  // the 9 cards is granted at once.
  drawBulk: (characterId: string) => Promise<DrawLuckyTicketResult>
}

export const useLuckyStore = create<LuckyState>((set, get) => ({
  nextFreeTicketAt: null,
  busy: false,

  hydrate: (claimedAt) => {
    set({ nextFreeTicketAt: claimedAt ? new Date(claimedAt).getTime() + LUCKY_FREE_TICKET_COOLDOWN_MS : null })
  },

  draw: async (characterId, cardIndex, useTicket = false) => {
    if (get().busy) {
      return { ok: false, error: 'rpc_failed' }
    }

    set({ busy: true })
    const { data, error } = await supabase.rpc('draw_lucky_ticket', {
      p_character_id: characterId,
      p_card_index: cardIndex,
      p_use_ticket: useTicket,
    })
    set({ busy: false })

    if (error) {
      console.error('draw_lucky_ticket call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as DrawLuckyTicketResult

    // next_free_ticket_at comes back on both success and the not_enough_ap
    // failure — always the authoritative cooldown boundary for the *free*
    // ticket specifically, unaffected by an AP-paid draw.
    if (result.next_free_ticket_at !== undefined) {
      set({ nextFreeTicketAt: result.next_free_ticket_at ? new Date(result.next_free_ticket_at).getTime() : null })
    }

    if (result.ok && result.character) {
      useProgressionStore.getState().setGold(result.character.gold)
      useCurrencyStore.getState().setComets(result.character.comet_count)
      useCurrencyStore.getState().setFallenStars(result.character.fallen_star_count)
      useCurrencyStore.getState().setCometScrolls(result.character.comet_scroll_count)
      useCurrencyStore.getState().setFallenStarScrolls(result.character.fallen_star_scroll_count)
      useCurrencyStore.getState().setLotteryTickets(result.character.lottery_ticket_count)
    }

    if (result.ok && typeof result.ascension_points === 'number') {
      usePlayerRecordStore.getState().setAscensionPoints(result.ascension_points)
    }

    // Item-producing kinds (money_bag/gem_bag/gear_*) — the RPC already
    // inserted the real item_instances row server-side, this just appends it
    // to local state without a full inventory refetch (addItem is upsert-by-id,
    // see useInventoryStore).
    if (result.ok && result.granted_item) {
      useInventoryStore.getState().addItem(result.granted_item)
    }

    // composition_stone / gem_tempered / gem_ascended — both jsonb columns
    // are server-authoritative, same trust model as comets/fallen stars.
    if (result.ok && result.composition_stones) {
      useCompositionStore.getState().setStones(result.composition_stones)
    }
    if (result.ok && result.gems) {
      useGemStore.getState().setGems(result.gems)
    }

    return result
  },

  drawBulk: async (characterId) => {
    if (get().busy) {
      return { ok: false, error: 'rpc_failed' }
    }

    set({ busy: true })
    const { data, error } = await supabase.rpc('draw_lucky_ticket_bulk', {
      p_character_id: characterId,
    })
    set({ busy: false })

    if (error) {
      console.error('draw_lucky_ticket_bulk call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as DrawLuckyTicketResult

    if (result.ok && result.character) {
      useProgressionStore.getState().setGold(result.character.gold)
      useCurrencyStore.getState().setComets(result.character.comet_count)
      useCurrencyStore.getState().setFallenStars(result.character.fallen_star_count)
      useCurrencyStore.getState().setCometScrolls(result.character.comet_scroll_count)
      useCurrencyStore.getState().setFallenStarScrolls(result.character.fallen_star_scroll_count)
      useCurrencyStore.getState().setLotteryTickets(result.character.lottery_ticket_count)
    }

    if (result.ok && typeof result.ascension_points === 'number') {
      usePlayerRecordStore.getState().setAscensionPoints(result.ascension_points)
    }

    if (result.ok && result.granted_items) {
      for (const item of result.granted_items) {
        useInventoryStore.getState().addItem(item)
      }
    }

    if (result.ok && result.composition_stones) {
      useCompositionStore.getState().setStones(result.composition_stones)
    }
    if (result.ok && result.gems) {
      useGemStore.getState().setGems(result.gems)
    }

    return result
  },
}))
