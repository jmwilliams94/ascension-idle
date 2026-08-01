import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useCurrencyStore } from '../stats/useCurrencyStore'

// Achievements & Pets, Stage 1 — client-side cache of the three new
// server-authoritative tables (character_monster_kills/account_monster_kills/
// account_pets). The client never writes these directly (no insert/update
// grant exists on any of them) — kill counts are only ever incremented inside
// resolve-combat, and unlocking a tier only ever happens through
// unlock_next_achievement_tier. This store just mirrors what the server
// already decided, same "server response reconciles local state" pattern
// every other store in this game already follows (useCurrencyStore,
// useCompositionStore, useWarehouseStore, etc.).
export interface CharacterKillEntry {
  kills: number
  unlockedTierIndex: number
}

interface UnlockNextTierResult {
  ok: boolean
  // 'rpc_failed' — new (2026-08-02) — the RPC call itself errored (network,
  // permission, or the function/migration not existing live yet), as opposed
  // to the function running successfully and returning a business-logic
  // rejection. Previously this case set no `error` at all, so the UI could
  // only ever show a generic "Something went wrong" with no way to tell
  // which of these two very different situations it actually was.
  error?: 'not_owner' | 'already_maxed' | 'not_enough_meteors' | 'not_enough_dragonballs' | 'rpc_failed'
  // Only set for 'rpc_failed' — the raw Supabase/Postgres error message, so
  // it can actually be shown instead of silently living in console.error.
  message?: string
  cost?: number
  currency?: 'meteor' | 'dragonball'
  meteors?: number
  dragonballs?: number
  unlocked_tier_index?: number
  meteors_remaining?: number
  dragonballs_remaining?: number
}

interface AchievementsState {
  // Keyed by monster id.
  characterKills: Record<string, CharacterKillEntry>
  accountKills: Record<string, number>
  pets: Set<string>
  loaded: boolean
  busy: boolean
  loadAchievements: (characterId: string, accountId: string) => Promise<void>
  unlockNextTier: (characterId: string, monsterId: string) => Promise<UnlockNextTierResult>
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
      supabase.from('character_monster_kills').select('monster_id, kills, unlocked_tier_index').eq('character_id', characterId),
      supabase.from('account_monster_kills').select('monster_id, kills').eq('account_id', accountId),
      supabase.from('account_pets').select('monster_id').eq('account_id', accountId),
    ])

    if (characterResult.error || accountResult.error || petsResult.error) {
      console.error(
        'Failed to load achievements',
        characterResult.error ?? accountResult.error ?? petsResult.error,
      )
      return
    }

    const characterKills: Record<string, CharacterKillEntry> = {}
    for (const row of characterResult.data ?? []) {
      characterKills[row.monster_id] = { kills: row.kills, unlockedTierIndex: row.unlocked_tier_index }
    }

    const accountKills: Record<string, number> = {}
    for (const row of accountResult.data ?? []) {
      accountKills[row.monster_id] = row.kills
    }

    const pets = new Set((petsResult.data ?? []).map((row) => row.monster_id as string))

    set({ characterKills, accountKills, pets, loaded: true })
  },

  unlockNextTier: async (characterId, monsterId) => {
    set({ busy: true })
    // Argument keys must match the SQL function's own parameter names exactly
    // (PostgREST maps them by name) — p_character_id/p_monster_id, not
    // character_id/monster_id, since the SQL function's parameters were
    // renamed to avoid colliding with character_monster_kills' own columns
    // of the same name (see the migration's own comment on this).
    const { data, error } = await supabase.rpc('unlock_next_achievement_tier', {
      p_character_id: characterId,
      p_monster_id: monsterId,
    })
    set({ busy: false })

    if (error) {
      console.error('Unlock next achievement tier call failed', error)
      return { ok: false, error: 'rpc_failed', message: error.message }
    }

    const result = data as UnlockNextTierResult

    if (result.ok && typeof result.unlocked_tier_index === 'number') {
      if (typeof result.meteors_remaining === 'number') {
        useCurrencyStore.getState().setMeteors(result.meteors_remaining)
      }
      if (typeof result.dragonballs_remaining === 'number') {
        useCurrencyStore.getState().setDragonballs(result.dragonballs_remaining)
      }
      set((state) => ({
        characterKills: {
          ...state.characterKills,
          [monsterId]: { kills: state.characterKills[monsterId]?.kills ?? 0, unlockedTierIndex: result.unlocked_tier_index! },
        },
      }))
    }

    return result
  },

  applyResolveResult: (monsterId, characterKillCount, accountKillCount, petObtained) => {
    set((state) => ({
      characterKills: {
        ...state.characterKills,
        [monsterId]: { kills: characterKillCount, unlockedTierIndex: state.characterKills[monsterId]?.unlockedTierIndex ?? 0 },
      },
      accountKills: { ...state.accountKills, [monsterId]: accountKillCount },
      pets: petObtained ? new Set(get().pets).add(petObtained) : state.pets,
    }))
  },
}))
