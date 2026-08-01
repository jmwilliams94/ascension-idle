import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useCurrencyStore } from '../stats/useCurrencyStore'

// Achievements & Pets, Stage 1 — client-side cache of the three new
// server-authoritative tables (character_monster_kills/account_monster_kills/
// account_pets). The client never writes these directly (no insert/update
// grant exists on any of them) — kill counts are only ever incremented inside
// resolve-combat, and the free→paid tier2 unlock only ever happens through
// unlock_achievement_tier2. This store just mirrors what the server already
// decided, same "server response reconciles local state" pattern every other
// store in this game already follows (useCurrencyStore, useCompositionStore,
// useWarehouseStore, etc.).
export interface CharacterKillEntry {
  kills: number
  tier2Unlocked: boolean
}

interface UnlockTier2Result {
  ok: boolean
  error?: 'not_owner' | 'already_unlocked' | 'not_enough_dragonballs'
  cost?: number
  dragonballs?: number
  dragonballs_spent?: number
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
  unlockTier2: (characterId: string, monsterId: string) => Promise<UnlockTier2Result>
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
      supabase.from('character_monster_kills').select('monster_id, kills, tier2_unlocked').eq('character_id', characterId),
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
      characterKills[row.monster_id] = { kills: row.kills, tier2Unlocked: row.tier2_unlocked }
    }

    const accountKills: Record<string, number> = {}
    for (const row of accountResult.data ?? []) {
      accountKills[row.monster_id] = row.kills
    }

    const pets = new Set((petsResult.data ?? []).map((row) => row.monster_id as string))

    set({ characterKills, accountKills, pets, loaded: true })
  },

  unlockTier2: async (characterId, monsterId) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('unlock_achievement_tier2', { character_id: characterId, monster_id: monsterId })
    set({ busy: false })

    if (error) {
      console.error('Unlock achievement tier2 call failed', error)
      return { ok: false }
    }

    const result = data as UnlockTier2Result

    if (result.ok) {
      if (typeof result.dragonballs_remaining === 'number') {
        useCurrencyStore.getState().setDragonballs(result.dragonballs_remaining)
      }
      set((state) => ({
        characterKills: {
          ...state.characterKills,
          [monsterId]: { kills: state.characterKills[monsterId]?.kills ?? 0, tier2Unlocked: true },
        },
      }))
    }

    return result
  },

  applyResolveResult: (monsterId, characterKillCount, accountKillCount, petObtained) => {
    set((state) => ({
      characterKills: {
        ...state.characterKills,
        [monsterId]: { kills: characterKillCount, tier2Unlocked: state.characterKills[monsterId]?.tier2Unlocked ?? false },
      },
      accountKills: { ...state.accountKills, [monsterId]: accountKillCount },
      pets: petObtained ? new Set(get().pets).add(petObtained) : state.pets,
    }))
  },
}))
