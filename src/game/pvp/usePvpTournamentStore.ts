import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// PvP Tournament/ladder client state — see CLAUDE.pvp.md. Not scoped to a
// single character — the ladder/bracket/champion are public, global state
// every player watches. Refetches the relevant slice whole on any realtime
// change (PvpTournamentConnection.tsx) rather than patching incrementally —
// dataset is small (at most a few hundred rows per class), and this avoids a
// whole client-side merge-reducer for state that's this cheap to just re-read.
//
// One independent tournament PER CLASS (2026-09-05, requested by the user —
// the PvP tab's new 2x2 class picker) — Hunter and Wuxia each run their own
// bracket/registration/champion on their own weekly schedule (Saturday/Sunday
// respectively), scoped server-side by pvp_tournaments.class_id. Twin-soul/
// Juggernaut have no backend event yet (PVP_EVENT_CLASSES below only lists
// the two that do) — extend that list the day their own event launches, no
// other change needed here.

export type PvpEventClassId = 'hunter' | 'wuxia'
export const PVP_EVENT_CLASSES: PvpEventClassId[] = ['hunter', 'wuxia']

export type PvpTournamentStatus = 'registration' | 'live' | 'completed'

export interface PvpTournament {
  id: string
  classId: PvpEventClassId
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
    classId: row.class_id as PvpEventClassId,
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

export interface PvpClassTournamentState {
  currentTournament: PvpTournament | null
  lastCompletedTournament: PvpTournament | null
  registrations: PvpTournamentRegistration[]
  matches: PvpTournamentMatch[]
}

const EMPTY_CLASS_STATE: PvpClassTournamentState = {
  currentTournament: null,
  lastCompletedTournament: null,
  registrations: [],
  matches: [],
}

// One class's full slice — factored out of loadAll so it can run once per
// entry in PVP_EVENT_CLASSES via Promise.all, same shape the old single-
// tournament loadAll used to fetch for "the" (Hunter-only) tournament.
async function loadClassTournament(classId: PvpEventClassId): Promise<PvpClassTournamentState> {
  await supabase.rpc('ensure_pvp_tournament_registration_open', { p_class_id: classId })

  const [{ data: current }, { data: lastCompleted }] = await Promise.all([
    supabase
      .from('pvp_tournaments')
      .select('*')
      .eq('class_id', classId)
      .in('status', ['registration', 'live'])
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('pvp_tournaments')
      .select('*')
      .eq('class_id', classId)
      .eq('status', 'completed')
      .order('updated_at', { ascending: false })
      .limit(1),
  ])

  const currentTournament = current && current.length > 0 ? toTournament(current[0] as Record<string, unknown>) : null
  const lastCompletedTournament = lastCompleted && lastCompleted.length > 0 ? toTournament(lastCompleted[0] as Record<string, unknown>) : null

  if (!currentTournament) {
    return { currentTournament, lastCompletedTournament, registrations: [], matches: [] }
  }

  const [{ data: regs }, { data: matches }] = await Promise.all([
    supabase.from('pvp_tournament_registrations').select('*').eq('tournament_id', currentTournament.id).order('registered_at', { ascending: true }),
    supabase.from('pvp_tournament_matches').select('*').eq('tournament_id', currentTournament.id).order('round', { ascending: true }).order('slot', { ascending: true }),
  ])

  const matchesWithHp = await attachWinnerHp((matches ?? []).map((row) => toMatch(row as Record<string, unknown>)))

  return {
    currentTournament,
    lastCompletedTournament,
    registrations: (regs ?? []).map((row) => toRegistration(row as Record<string, unknown>)),
    matches: matchesWithHp,
  }
}

interface PvpTournamentState {
  byClass: Record<PvpEventClassId, PvpClassTournamentState>
  busy: boolean
  loadAll: () => Promise<void>
  register: (classId: PvpEventClassId, characterId: string) => Promise<{ ok: boolean; error?: string }>
}

export const usePvpTournamentStore = create<PvpTournamentState>((set, get) => ({
  byClass: {
    hunter: EMPTY_CLASS_STATE,
    wuxia: EMPTY_CLASS_STATE,
  },
  busy: false,

  loadAll: async () => {
    const entries = await Promise.all(PVP_EVENT_CLASSES.map(async (classId) => [classId, await loadClassTournament(classId)] as const))
    set({ byClass: Object.fromEntries(entries) as Record<PvpEventClassId, PvpClassTournamentState> })
  },

  register: async (classId, characterId) => {
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
      const slice = await loadClassTournament(classId)
      set((state) => ({ byClass: { ...state.byClass, [classId]: slice } }))
    }
    return result
  },
}))

export interface PvpChampion {
  characterId: string
  name: string
  title: string
  classId: PvpEventClassId
}

function deriveChampion(classId: PvpEventClassId, slice: PvpClassTournamentState | undefined): PvpChampion | null {
  if (!slice || slice.currentTournament?.status !== 'registration') {
    return null
  }
  const lastCompleted = slice.lastCompletedTournament
  if (!lastCompleted?.winnerCharacterId || !lastCompleted.winnerName) {
    return null
  }
  return {
    characterId: lastCompleted.winnerCharacterId,
    name: lastCompleted.winnerName,
    title: lastCompleted.championTitle ?? 'Champion',
    classId,
  }
}

// Rotating champion badge ("Top Hunter" / "Top Wuxia", 2026-09-05, requested
// by the user) — derived from existing tournament rows rather than stored
// anywhere new. The most recently completed tournament's winner holds the
// title only until the FOLLOWING tournament of the SAME class actually goes
// live (status flips 'registration' -> 'live') — at that instant nobody
// holds it (a brief gap through the live event), until it completes and
// hands the badge to whoever wins next. `byClass` is kept live app-wide by
// PvpTournamentConnection.tsx (mounted unconditionally in GameShell, same as
// GlobalActivityConnection), so this reflects in real time with no extra
// fetch and works from any screen, not just the PvP tab.
//
// classId is the character/loadout being VIEWED, not the viewer's own class
// — pass null/undefined for a class with no event yet (Twin-soul/Juggernaut)
// and this safely returns null.
export function useCurrentPvpChampion(classId: PvpEventClassId | null | undefined): PvpChampion | null {
  const slice = usePvpTournamentStore((state) => (classId ? state.byClass[classId] : undefined))
  if (!classId) {
    return null
  }
  return deriveChampion(classId, slice)
}

// Same derivation as above, but across every class with a real event at
// once — for Global Chat, which doesn't know a message's sender's class from
// the message alone and has to check "does this name match ANY current
// champion" instead of one specific class's.
export function useAllCurrentPvpChampions(): PvpChampion[] {
  const byClass = usePvpTournamentStore((state) => state.byClass)
  return PVP_EVENT_CLASSES.map((classId) => deriveChampion(classId, byClass[classId])).filter((c): c is PvpChampion => c !== null)
}

// On-demand bracket lookup (2026-09-05, requested by the user — "View
// Bracket" button on a past tournament) — deliberately NOT folded into the
// store's own `matches` field, which is scoped to each class's
// currentTournament only and kept live via PvpTournamentConnection's realtime
// subscription. A completed tournament's bracket never changes again, so
// this is a one-off fetch for whichever tournament the "View Bracket" modal
// is currently showing, not something that needs a live subscription of its
// own. Class-agnostic — pvp_tournament_matches is scoped by tournament_id,
// which is already scoped to one class via its own pvp_tournaments row.
export async function fetchPvpTournamentMatches(tournamentId: string): Promise<PvpTournamentMatch[]> {
  const { data } = await supabase
    .from('pvp_tournament_matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('round', { ascending: true })
    .order('slot', { ascending: true })

  return attachWinnerHp((data ?? []).map((row) => toMatch(row as Record<string, unknown>)))
}
