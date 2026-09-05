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
  // Winner's HP remaining at the moment the match ended (2026-09-05,
  // requested by the user — "how close it was") — null for a bye (no real
  // fight happened) or while attachWinnerHp hasn't resolved yet. Sourced from
  // the underlying pvp_duels row, not stored on this table itself.
  winnerHp: number | null
  winnerMaxHp: number | null
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
    winnerHp: null,
    winnerMaxHp: null,
  }
}

// Fills in winnerHp/winnerMaxHp from the underlying pvp_duels row for every
// decided match that actually had a real duel (skips byes, and anything
// still in progress with no winner yet) — a single batched `in (...)` fetch
// rather than one query per match. pvp_duels is never deleted once created
// (see CLAUDE.pvp.md), so this works for a tournament from any point in the
// past, not just the current one.
async function attachWinnerHp(matches: PvpTournamentMatch[]): Promise<PvpTournamentMatch[]> {
  const duelIds = [...new Set(matches.filter((m) => m.duelId && m.winnerCharacterId).map((m) => m.duelId as string))]
  if (duelIds.length === 0) {
    return matches
  }

  const { data } = await supabase
    .from('pvp_duels')
    .select('id, player_a_character_id, player_b_character_id, player_a_hp, player_b_hp, player_a_max_hp, player_b_max_hp')
    .in('id', duelIds)

  const duelById = new Map((data ?? []).map((row) => [row.id as string, row as Record<string, unknown>]))

  return matches.map((match) => {
    if (!match.duelId || !match.winnerCharacterId) {
      return match
    }
    const duel = duelById.get(match.duelId)
    if (!duel) {
      return match
    }
    const winnerIsA = match.winnerCharacterId === (duel.player_a_character_id as string)
    return {
      ...match,
      winnerHp: (winnerIsA ? duel.player_a_hp : duel.player_b_hp) as number,
      winnerMaxHp: (winnerIsA ? duel.player_a_max_hp : duel.player_b_max_hp) as number,
    }
  })
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

    const matchesWithHp = await attachWinnerHp((matches ?? []).map((row) => toMatch(row as Record<string, unknown>)))

    set({
      registrations: (regs ?? []).map((row) => toRegistration(row as Record<string, unknown>)),
      matches: matchesWithHp,
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

// On-demand bracket lookup (2026-09-05, requested by the user — "View
// Bracket" button on a past tournament) — deliberately NOT folded into the
// store's own `matches` field, which is scoped to currentTournament only and
// kept live via PvpTournamentConnection's realtime subscription. A completed
// tournament's bracket never changes again, so this is a one-off fetch for
// whichever tournament the "View Bracket" modal is currently showing, not
// something that needs a live subscription of its own.
export async function fetchPvpTournamentMatches(tournamentId: string): Promise<PvpTournamentMatch[]> {
  const { data } = await supabase
    .from('pvp_tournament_matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('round', { ascending: true })
    .order('slot', { ascending: true })

  return attachWinnerHp((data ?? []).map((row) => toMatch(row as Record<string, unknown>)))
}
