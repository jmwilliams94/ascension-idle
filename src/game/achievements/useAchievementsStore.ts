import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { characterTierIndexReached, accountTierIndexReached, zoneTierCompletions } from './achievementData'
import { ZONES, ZONE_ORDER } from '../zones/zoneData'

// Achievements & Pets — client-side cache of the four server-authoritative
// tables (character_monster_kills/account_monster_kills/account_pets, plus
// players.account_zone_attack_bonus_pct/account_zone_drop_bonus_pct read via
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
  comet_scrolls_granted?: number
  lottery_tickets_granted?: number
  comets_remaining?: number
  comet_scrolls_remaining?: number
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
  zone_id?: string
  // Both per-zone now (2026-08-07) — the full updated maps, same shape as
  // usePlayerRecordStore's own accountZoneAttackBonusPct/accountZoneDropBonusPct.
  account_zone_attack_bonus_pct?: Record<string, number>
  account_zone_drop_bonus_pct?: Record<string, number>
}

interface ClaimZoneTierResult {
  ok: boolean
  error?: 'not_owner' | 'already_maxed' | 'not_reached' | 'rpc_failed'
  message?: string
  threshold?: number
  completions?: number
  claimed_zone_tier?: number
  comet_scrolls_granted?: number
  comet_scrolls_remaining?: number
}

interface AchievementsState {
  // Both keyed by monster id.
  characterKills: Record<string, MonsterKillEntry>
  accountKills: Record<string, MonsterKillEntry>
  // Keyed by zone id — highest zone tier (0-6) actually claimed so far,
  // mirrors character_zone_progress.claimed_zone_tier.
  zoneClaims: Record<string, number>
  pets: Set<string>
  loaded: boolean
  busy: boolean
  loadAchievements: (characterId: string, accountId: string) => Promise<void>
  claimCharacterTier: (characterId: string, monsterId: string) => Promise<ClaimCharacterTierResult>
  claimAccountTier: (accountId: string, monsterId: string) => Promise<ClaimAccountTierResult>
  claimZoneTier: (characterId: string, zoneId: string) => Promise<ClaimZoneTierResult>
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
  zoneClaims: {},
  pets: new Set(),
  loaded: false,
  busy: false,

  loadAchievements: async (characterId, accountId) => {
    const [characterResult, accountResult, petsResult, zoneProgressResult] = await Promise.all([
      supabase.from('character_monster_kills').select('monster_id, kills, claimed_tier_index').eq('character_id', characterId),
      supabase.from('account_monster_kills').select('monster_id, kills, claimed_tier_index').eq('account_id', accountId),
      supabase.from('account_pets').select('monster_id').eq('account_id', accountId),
      supabase.from('character_zone_progress').select('zone_id, claimed_zone_tier').eq('character_id', characterId),
    ])

    if (characterResult.error || accountResult.error || petsResult.error || zoneProgressResult.error) {
      console.error(
        'Failed to load achievements',
        characterResult.error ?? accountResult.error ?? petsResult.error ?? zoneProgressResult.error,
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

    const zoneClaims: Record<string, number> = {}
    for (const row of zoneProgressResult.data ?? []) {
      zoneClaims[row.zone_id] = row.claimed_zone_tier
    }

    set({ characterKills, accountKills, pets, zoneClaims, loaded: true })
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
      if (typeof result.comet_scrolls_remaining === 'number') {
        useCurrencyStore.getState().setCometScrolls(result.comet_scrolls_remaining)
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
      if (result.account_zone_attack_bonus_pct) {
        usePlayerRecordStore.getState().setAccountZoneAttackBonusPct(result.account_zone_attack_bonus_pct)
      }
      if (result.account_zone_drop_bonus_pct) {
        usePlayerRecordStore.getState().setAccountZoneDropBonusPct(result.account_zone_drop_bonus_pct)
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

  claimZoneTier: async (characterId, zoneId) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('claim_zone_tier_reward', {
      p_character_id: characterId,
      p_zone_id: zoneId,
    })
    set({ busy: false })

    if (error) {
      console.error('Claim zone tier reward call failed', error)
      return { ok: false, error: 'rpc_failed', message: error.message }
    }

    const result = data as ClaimZoneTierResult

    if (result.ok && typeof result.claimed_zone_tier === 'number') {
      if (typeof result.comet_scrolls_remaining === 'number') {
        useCurrencyStore.getState().setCometScrolls(result.comet_scrolls_remaining)
      }
      set((state) => ({
        zoneClaims: { ...state.zoneClaims, [zoneId]: result.claimed_zone_tier! },
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
// zoneClaims is optional so existing callers that haven't been updated yet
// degrade gracefully (zone-tier claims just don't count toward the badge).
export function totalClaimableCount(
  characterKills: Record<string, MonsterKillEntry>,
  accountKills: Record<string, MonsterKillEntry>,
  zoneClaims?: Record<string, number>,
): number {
  let total = 0
  for (const entry of Object.values(characterKills)) {
    total += Math.max(0, characterTierIndexReached(entry.kills) - entry.claimedTierIndex)
  }
  for (const entry of Object.values(accountKills)) {
    total += Math.max(0, accountTierIndexReached(entry.kills) - entry.claimedTierIndex)
  }
  if (zoneClaims) {
    for (const zoneId of ZONE_ORDER) {
      const zoneMonsterKills = ZONES[zoneId].monsterOrder.map((monsterId) => characterKills[monsterId]?.kills ?? 0)
      const { zoneTier } = zoneTierCompletions(zoneMonsterKills)
      total += Math.max(0, zoneTier - (zoneClaims[zoneId] ?? 0))
    }
  }
  return total
}
