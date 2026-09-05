import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// PvP Tournament/ladder client state — see CLAUDE.md's plan
// nifty-riding-journal (Phase 3). Unlike usePvpDuelStore, this is not
// scoped to a single character — the ladder/bracket/champion are public,
// global state every player watches. Refetches the relevant slice whole on
// any realtime change (PvpTournamentConnection.tsx) rather than patching
// incrementally — dataset is small (at most a few hundred rows), and this
// avoids a whole client-side merge-reducer for state that's this cheap to
// just re-read.

export type PvpTournamentStatus = 'registration' | 'live' | 'completed'

export interface PvpTournament {
  id: string
  status: PvpTournamentStatus
  eventStartsAt: string
  winnerCharacterId: string | null
  winnerName: string | null
  championTitle: string | null
}

export interface PvpTournamentRegistration {
  characterId: string
  characterName: string
  registeredAt: string
}

export interface PvpTournamentMatch {
  id: string
  round: number
  slot: number
  characterAId: string | null
  characterAName: string | null
  characterBId: string | null
  characterBName: string | null
  duelId: string | null
  winnerCharacterId: string | null
  status: 'active' | 'completed'
}

function toTournament(row: Record<string, unknown>): PvpTournament {
  return {
    id: row.id as string,
    status: row.status as PvpTournamentStatus,
    eventStartsAt: row.event_starts_at as string,
    winnerCharacterId: (row.winner_character_id as string | null) ?? null,
    winnerName: (row.winner_name as string | null) ?? null,
    championTitle: (row.champion_title as string | null) ?? null,
  }
}

function toRegistration(row: Record<string, unknown>): PvpTournamentRegistration {
  return {
    characterId: row.character_id as string,
    characterName: row.character_name as string,
    registeredAt: row.registered_at as string,
  }
}

function toMatch(row: Record<string, unknown>): PvpTournamentMatch {
  return {
    id: row.id as string,
    round: Number(row.round),
    slot: Number(row.slot),
    characterAId: (row.character_a_id as string | null) ?? null,
    characterAName: (row.character_a_name as string | null) ?? null,
    characterBId: (row.character_b_id as string | null) ?? null,
    characterBName: (row.character_b_name as string | null) ?? null,
    duelId: (row.duel_id as string | null) ?? null,
    winnerCharacterId: (row.winner_character_id as string | null) ?? null,
    status: row.status as 'active' | 'completed',
  }
}

interface PvpTournamentState {
  currentTournament: PvpTournament | null
  lastCompletedTournament: PvpTournament | null
  registrations: PvpTournamentRegistration[]
  matches: PvpTournamentMatch[]
  busy: boolean
  loadAll: () => Promise<void>
  register: (characterId: string) => Promise<{ ok: boolean; error?: string }>
}

export const usePvpTournamentStore = create<PvpTournamentState>((set, get) => ({
  currentTournament: null,
  lastCompletedTournament: null,
  registrations: [],
  matches: [],
  busy: false,

  loadAll: async () => {
    // Lazy-ensure, same convention as ensure_world_boss_spawn — guarantees
    // there's always something open to register into, called on whoever's
    // client happens to load this next.
    await supabase.rpc('ensure_pvp_tournament_registration_open')

    const [{ data: current }, { data: lastCompleted }] = await Promise.all([
      supabase.from('pvp_tournaments').select('*').in('status', ['registration', 'live']).order('created_at', { ascending: false }).limit(1),
      supabase.from('pvp_tournaments').select('*').eq('status', 'completed').order('updated_at', { ascending: false }).limit(1),
    ])

    const currentTournament = current && current.length > 0 ? toTournament(current[0] as Record<string, unknown>) : null
    set({
      currentTournament,
      lastCompletedTournament: lastCompleted && lastCompleted.length > 0 ? toTournament(lastCompleted[0] as Record<string, unknown>) : null,
    })

    if (!currentTournament) {
      set({ registrations: [], matches: [] })
      return
    }

    const [{ data: regs }, { data: matches }] = await Promise.all([
      supabase.from('pvp_tournament_registrations').select('*').eq('tournament_id', currentTournament.id).order('registered_at', { ascending: true }),
      supabase.from('pvp_tournament_matches').select('*').eq('tournament_id', currentTournament.id).order('round', { ascending: true }).order('slot', { ascending: true }),
    ])

    set({
      registrations: (regs ?? []).map((row) => toRegistration(row as Record<string, unknown>)),
      matches: (matches ?? []).map((row) => toMatch(row as Record<string, unknown>)),
    })
  },

  register: async (characterId) => {
    if (get().busy) return { ok: false, error: 'busy' }
    set({ busy: true })
    const { data, error } = await supabase.rpc('register_for_pvp_tournament', { p_character_id: characterId })
    set({ busy: false })

    if (error) {
      console.error('register_for_pvp_tournament failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as { ok: boolean; error?: string }
    if (result.ok) {
      void get().loadAll()
    }
    return result
  },
}))

export interface PvpChampion {
  characterId: string
  name: string
  title: string
}

// Rotating "Top Hunter" champion badge (2026-09-05, requested by the user) —
// derived from existing tournament rows rather than stored anywhere new. The
// most recently completed tournament's winner holds the title only until the
// FOLLOWING tournament actually goes live (status flips to 'registration' ->
// 'live') — at that instant nobody holds it (a brief gap through the live
// event), until it completes and hands the badge to whoever wins next. Both
// currentTournament/lastCompletedTournament are kept live app-wide by
// PvpTournamentConnection.tsx (mounted unconditionally in GameShell, same as
// GlobalActivityConnection), so this reflects in real time with no extra
// fetch and works from any screen, not just the PvP tab.
export function useCurrentPvpChampion(): PvpChampion | null {
  const currentTournament = usePvpTournamentStore((state) => state.currentTournament)
  const lastCompleted = usePvpTournamentStore((state) => state.lastCompletedTournament)

  if (currentTournament?.status !== 'registration') {
    return null
  }
  if (!lastCompleted?.winnerCharacterId || !lastCompleted.winnerName) {
    return null
  }

  return {
    characterId: lastCompleted.winnerCharacterId,
    name: lastCompleted.winnerName,
    title: lastCompleted.championTitle ?? 'Champion',
  }
}
