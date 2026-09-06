import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useDailyQuestRewardStore } from './useDailyQuestRewardStore'

// Daily Quests — see CLAUDE.daily-quests.md. Per-character, server-verified
// progress (resolve_combat_apply_results/apply_world_boss_attack/donate_gold/
// the 5 socket-granting upgrade functions all call bump_daily_quest_progress
// directly — this store never increments progress locally, only reflects
// whatever ensure_daily_quests/claim_daily_quest returns). No Realtime
// subscription needed (unlike Gold Donation/Zone Boss) since this is purely
// per-character state, not cross-player shared state.

export type DailyQuestType = 'quality_order' | 'kill_count' | 'world_boss_attacks' | 'gold_donation' | 'socket_obtain'

export interface DailyQuest {
  slot: number
  type: DailyQuestType
  target: Record<string, unknown>
  progress: number
  claimed: boolean
}

export type DailyQuestClaimError =
  | 'not_owner'
  | 'invalid_slot'
  | 'already_claimed'
  | 'item_required'
  | 'item_ineligible'
  | 'not_complete'
  | 'not_enough_room'
  | 'rpc_failed'

export type DailyQuestReward =
  | { kind: 'exp'; amount: number; exp: number; level: number; ball_count?: number }
  | { kind: 'lottery_ticket'; amount: number; lottery_ticket_count: number }
  | { kind: 'exp_and_comet_scroll'; exp_amount: number; exp: number; level: number; comet_scroll_count: number }
  | { kind: 'money_bag'; item: ItemInstance }
  | { kind: 'fallen_star_scroll'; amount: number; fallen_star_scroll_count: number }

interface DailyQuestsState {
  quests: DailyQuest[]
  busy: boolean
  ensure: (characterId: string) => Promise<void>
  claim: (
    characterId: string,
    slot: number,
    itemId?: string,
  ) => Promise<{ ok: boolean; error?: DailyQuestClaimError; reward?: DailyQuestReward }>
}

function toQuest(row: Record<string, unknown>): DailyQuest {
  return {
    slot: Number(row.slot),
    type: row.type as DailyQuestType,
    target: (row.target as Record<string, unknown>) ?? {},
    progress: Number(row.progress ?? 0),
    claimed: Boolean(row.claimed),
  }
}

export const useDailyQuestsStore = create<DailyQuestsState>((set, get) => ({
  quests: [],
  busy: false,

  ensure: async (characterId) => {
    const { data, error } = await supabase.rpc('ensure_daily_quests', { p_character_id: characterId })
    if (error) {
      console.error('ensure_daily_quests call failed', error)
      return
    }
    const result = data as { ok: boolean; quests?: Record<string, unknown>[] }
    if (result.ok && result.quests) {
      set({ quests: result.quests.map(toQuest) })
    }
  },

  claim: async (characterId, slot, itemId) => {
    if (get().busy) {
      return { ok: false, error: 'rpc_failed' }
    }

    set({ busy: true })
    const { data, error } = await supabase.rpc('claim_daily_quest', {
      p_character_id: characterId,
      p_slot: slot,
      p_item_id: itemId ?? null,
    })
    set({ busy: false })

    if (error) {
      console.error('claim_daily_quest call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as {
      ok: boolean
      error?: DailyQuestClaimError
      reward?: DailyQuestReward
      quests?: Record<string, unknown>[]
    }

    if (!result.ok) {
      return { ok: false, error: result.error }
    }

    if (result.quests) {
      set({ quests: result.quests.map(toQuest) })
    }

    const reward = result.reward
    if (reward) {
      if (reward.kind === 'exp') {
        useProgressionStore.getState().applyServerCombatResult({ goldGained: 0, exp: reward.exp, level: reward.level })
      } else if (reward.kind === 'exp_and_comet_scroll') {
        useProgressionStore.getState().applyServerCombatResult({ goldGained: 0, exp: reward.exp, level: reward.level })
        useCurrencyStore.getState().setCometScrolls(reward.comet_scroll_count)
      } else if (reward.kind === 'lottery_ticket') {
        useCurrencyStore.getState().setLotteryTickets(reward.lottery_ticket_count)
      } else if (reward.kind === 'fallen_star_scroll') {
        useCurrencyStore.getState().setFallenStarScrolls(reward.fallen_star_scroll_count)
      } else if (reward.kind === 'money_bag') {
        useInventoryStore.getState().addItem(reward.item)
      }

      // Explicit reveal, not a silent store update (requested by the user —
      // no quest should just quietly land in the inventory/currency counts
      // with no confirmation of what was actually won).
      useDailyQuestRewardStore.getState().show(reward)
    }

    // Quality Order's turn-in item was deleted server-side — drop it locally
    // too, same "server already wrote it, just reflect it" pattern as every
    // other destructive Forge action (see useInventoryStore.removeItems).
    if (itemId) {
      useInventoryStore.getState().removeItems([itemId])
    }

    return { ok: true, reward }
  },
}))
