import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { characterTierIndexReached, accountTierIndexReached } from './achievementData'

// Achievements & Pets — client-side cache of the four server-authoritative
// tables (character_monster_kills/account_monster_kills/account_pets, plus
// players.account_attack_bonus_pct/account_drop_bonus_pct read via
// usePlayerRecordStore). The client never writes kill counts directly (no
// insert/update grant exists on any of them) — they're only ever incremented
// inside resolve-combat. Claiming a tier's reward is the one thing the
// client DOES trigger, via claim_kill_count_reward/
// claim_account_achievement_reward (see claimCharacterTier/claimAccountTier
// below) — same "server response reconciles local state" pattern every
// other store in this game already follows.
//
// Reworked (2026-08-06, confirmed with the user) — see achievementData.ts's
// own header for the full design writeup. Prestige (unlockedTierIndex, paid
// escalating-cost tier unlocks) is gone; claimedTierIndex now means "how
// many of the 6 tiers has this monster's ladder actually been CLAIMED
// through," earned by kills + a free claim action instead of currency.
export interface MonsterKillEntry {
  kills: number
  claimedTierIndex: number
}

interface ClaimCharacterTierResult {
  ok: boolean
  error?: 'not_owner' | 'no_kills_yet' | 'already_maxed' | 'not_reached' | 'no_reward_available' | 'rpc_failed'
  message?: string
  threshold?: number
  kills?: number
  claimed_tier_index?: number
  comets_granted?: number
  fallen_stars_granted?: number
  lottery_tickets_granted?: number
  comets_remaining?: number
  fallen_stars_remaining?: number
  lottery_tickets_remaining?: number
  item?: ItemInstance
}

interface ClaimAccountTierResult {
  ok: boolean
  error?: 'not_owner' | 'no_kills_yet' | 'already_maxed' | 'not_reached' | 'rpc_failed'
  message?: string
  threshold?: number
  kills?: number
  claimed_tier_index?: number
  attack_bonus_gained?: number
  drop_bonus_gained?: number
  account_attack_bonus_pct?: number
  account_drop_bonus_pct?: number
}

interface AchievementsState {
  // Both keyed by monster id.
  characterKills: Record<string, MonsterKillEntry>
  accountKills: Record<string, MonsterKillEntry>
  pets: Set<string>
  loaded: boolean
  busy: boolean
  loadAchievements: (characterId: string, accountId: string) => Promise<void>
  claimCharacterTier: (characterId: string, monsterId: string) => Promise<ClaimCharacterTierResult>
  claimAccountTier: (accountId: string, monsterId: string) => Promise<ClaimAccountTierResult>
  // Called from resolveCombat.ts with a resolve-combat response's
  // monsterId/characterKillCount/accountKillCount/petObtained — reflects the
  // server's already-confirmed result without a refetch, same pattern
  // useProgressionStore.applyServerCombatResult already uses for gold/exp.
  applyResolveResult: (
    monsterId: string,
    characterKillCount: number,
    accountKillCount: number,
    petObtained: string | null,
  ) => void
}

export const useAchievementsStore = create<AchievementsState>((set, get) => ({
  characterKills: {},
  accountKills: {},
  pets: new Set(),
  loaded: false,
  busy: false,

  loadAchievements: async (characterId, accountId) => {
    const [characterResult, accountResult, petsResult] = await Promise.all([
      supabase.from('character_monster_kills').select('monster_id, kills, claimed_tier_index').eq('character_id', characterId),
      supabase.from('account_monster_kills').select('monster_id, kills, claimed_tier_index').eq('account_id', accountId),
      supabase.from('account_pets').select('monster_id').eq('account_id', accountId),
    ])

    if (characterResult.error || accountResult.error || petsResult.error) {
      console.error(
        'Failed to load achievements',
        characterResult.error ?? accountResult.error ?? petsResult.error,
      )
      return
    }

    const characterKills: Record<string, MonsterKillEntry> = {}
    for (const row of characterResult.data ?? []) {
      characterKills[row.monster_id] = { kills: row.kills, claimedTierIndex: row.claimed_tier_index }
    }

    const accountKills: Record<string, MonsterKillEntry> = {}
    for (const row of accountResult.data ?? []) {
      accountKills[row.monster_id] = { kills: row.kills, claimedTierIndex: row.claimed_tier_index }
    }

    const pets = new Set((petsResult.data ?? []).map((row) => row.monster_id as string))

    set({ characterKills, accountKills, pets, loaded: true })
  },

  claimCharacterTier: async (characterId, monsterId) => {
    set({ busy: true })
    // Argument keys must match the SQL function's own parameter names exactly
    // (PostgREST maps them by name) — p_character_id/p_monster_id.
    const { data, error } = await supabase.rpc('claim_kill_count_reward', {
      p_character_id: characterId,
      p_monster_id: monsterId,
    })
    set({ busy: false })

    if (error) {
      console.error('Claim kill count reward call failed', error)
      return { ok: false, error: 'rpc_failed', message: error.message }
    }

    const result = data as ClaimCharacterTierResult

    if (result.ok && typeof result.claimed_tier_index === 'number') {
      if (typeof result.comets_remaining === 'number') {
        useCurrencyStore.getState().setComets(result.comets_remaining)
      }
      if (typeof result.fallen_stars_remaining === 'number') {
        useCurrencyStore.getState().setFallenStars(result.fallen_stars_remaining)
      }
      if (typeof result.lottery_tickets_remaining === 'number') {
        useCurrencyStore.getState().setLotteryTickets(result.lottery_tickets_remaining)
      }
      if (result.item) {
        useInventoryStore.getState().addItem(result.item)
      }
      set((state) => ({
        characterKills: {
          ...state.characterKills,
          [monsterId]: {
            kills: state.characterKills[monsterId]?.kills ?? 0,
            claimedTierIndex: result.claimed_tier_index!,
          },
        },
      }))
    }

    return result
  },

  claimAccountTier: async (accountId, monsterId) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('claim_account_achievement_reward', {
      p_account_id: accountId,
      p_monster_id: monsterId,
    })
    set({ busy: false })

    if (error) {
      console.error('Claim account achievement reward call failed', error)
      return { ok: false, error: 'rpc_failed', message: error.message }
    }

    const result = data as ClaimAccountTierResult

    if (result.ok && typeof result.claimed_tier_index === 'number') {
      if (typeof result.account_attack_bonus_pct === 'number') {
        usePlayerRecordStore.getState().setAccountAttackBonusPct(result.account_attack_bonus_pct)
      }
      if (typeof result.account_drop_bonus_pct === 'number') {
        usePlayerRecordStore.getState().setAccountDropBonusPct(result.account_drop_bonus_pct)
      }
      set((state) => ({
        accountKills: {
          ...state.accountKills,
          [monsterId]: {
            kills: state.accountKills[monsterId]?.kills ?? 0,
            claimedTierIndex: result.claimed_tier_index!,
          },
        },
      }))
    }

    return result
  },

  applyResolveResult: (monsterId, characterKillCount, accountKillCount, petObtained) => {
    set((state) => ({
      characterKills: {
        ...state.characterKills,
        [monsterId]: {
          kills: characterKillCount,
          claimedTierIndex: state.characterKills[monsterId]?.claimedTierIndex ?? 0,
        },
      },
      accountKills: {
        ...state.accountKills,
        [monsterId]: {
          kills: accountKillCount,
          claimedTierIndex: state.accountKills[monsterId]?.claimedTierIndex ?? 0,
        },
      },
      pets: petObtained ? new Set(get().pets).add(petObtained) : state.pets,
    }))
  },
}))

// How many tiers, across every monster this character/account has any kill
// data for, are reached but not yet claimed — drives the Achievements nav
// badge. Takes the two records as plain arguments rather than reading the
// store itself, so callers select the raw `characterKills`/`accountKills`
// fields (stable references) and compute this as a local variable in the
// component body — never inside a Zustand selector callback directly, which
// would allocate a new number-carrying closure result on every store
// notification and risk the infinite-render pitfall documented for
// array/object-producing selectors elsewhere in this codebase.
export function totalClaimableCount(
  characterKills: Record<string, MonsterKillEntry>,
  accountKills: Record<string, MonsterKillEntry>,
): number {
  let total = 0
  for (const entry of Object.values(characterKills)) {
    total += Math.max(0, characterTierIndexReached(entry.kills) - entry.claimedTierIndex)
  }
  for (const entry of Object.values(accountKills)) {
    total += Math.max(0, accountTierIndexReached(entry.kills) - entry.claimedTierIndex)
  }
  return total
}
