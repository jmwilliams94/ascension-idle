import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'

// LuckyLad's ticket draw — Stage 1 (see CLAUDE.md's Lucky section, and the
// migration's own header for the full write-up). The tab/mascot is named
// "LuckyLad" (renamed from the plain "Lucky" label, 2026-08-03, confirmed
// with the user, wording + mascot art only — TabId/route/store names are all
// unchanged). Free draw every 6 hours, uncapped paid extras at a flat cost.
// draw() is the whole mechanic in one call — eligibility, the blind 9-card
// roll, granting the pick, and revealing the board all happen server-side
// inside draw_lucky_ticket before anything is returned, so there's nothing
// to inspect ahead of an irrevocable choice.
export const LUCKY_TICKET_AP_COST = 20
export const LUCKY_FREE_TICKET_COOLDOWN_MS = 6 * 60 * 60 * 1000
export const LUCKY_CARD_COUNT = 9

// Real art (2026-08-03), user-supplied, same trim/pad/resize-to-160
// convention as every other icon this session — all three already had real
// transparency, so no flood-fill background removal was needed this time.
const BASE_URL = import.meta.env.BASE_URL
export const LUCKYLAD_ICON_SRC = `${BASE_URL}lucky-icons/luckylad.png`
export const CHEST_CLOSED_ICON_SRC = `${BASE_URL}lucky-icons/chest-closed.png`
export const CHEST_OPEN_ICON_SRC = `${BASE_URL}lucky-icons/chest-open.png`

export type LuckyRewardKind = 'gold' | 'meteor' | 'dragonball' | 'meteor_scroll' | 'dragonball_scroll'

export interface LuckyReward {
  kind: LuckyRewardKind
  amount: number
}

interface LuckyCharacterTotals {
  gold: number
  meteor_count: number
  dragonball_count: number
  meteor_scroll_count: number
  dragonball_scroll_count: number
}

export interface DrawLuckyTicketResult {
  ok: boolean
  error?: 'invalid_card_index' | 'not_owner' | 'not_enough_ap' | 'rpc_failed'
  cost?: number
  ascension_points?: number
  next_free_ticket_at?: string | null
  board?: LuckyReward[]
  won_index?: number
  payment?: 'free' | 'ascension_points'
  character?: LuckyCharacterTotals
}

interface LuckyState {
  // Epoch ms the free ticket next becomes available — null means it's
  // available right now (never claimed, or the 6h window has already passed).
  nextFreeTicketAt: number | null
  busy: boolean
  hydrate: (claimedAt: string | null) => void
  draw: (characterId: string, cardIndex: number) => Promise<DrawLuckyTicketResult>
}

export const useLuckyStore = create<LuckyState>((set, get) => ({
  nextFreeTicketAt: null,
  busy: false,

  hydrate: (claimedAt) => {
    set({ nextFreeTicketAt: claimedAt ? new Date(claimedAt).getTime() + LUCKY_FREE_TICKET_COOLDOWN_MS : null })
  },

  draw: async (characterId, cardIndex) => {
    if (get().busy) {
      return { ok: false, error: 'rpc_failed' }
    }

    set({ busy: true })
    const { data, error } = await supabase.rpc('draw_lucky_ticket', {
      p_character_id: characterId,
      p_card_index: cardIndex,
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
      useCurrencyStore.getState().setMeteors(result.character.meteor_count)
      useCurrencyStore.getState().setDragonballs(result.character.dragonball_count)
      useCurrencyStore.getState().setMeteorScrolls(result.character.meteor_scroll_count)
      useCurrencyStore.getState().setDragonballScrolls(result.character.dragonball_scroll_count)
    }

    if (result.ok && typeof result.ascension_points === 'number') {
      usePlayerRecordStore.getState().setAscensionPoints(result.ascension_points)
    }

    return result
  },
}))
