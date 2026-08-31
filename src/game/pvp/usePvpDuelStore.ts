import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// PvP Duel client state — see CLAUDE.md's plan nifty-riding-journal (Phase
// 2). Mirrors public.pvp_duels exactly (20261124000000_pvp_duel_symmetric_hiding.sql) —
// this store never computes damage/hit results itself, only ever applies
// whatever resolve-pvp-duel / the realtime subscription (PvpDuelConnection)
// hands back, same "server is the sole source of truth" convention as
// useZoneBossStore.ts.
//
// Both players hide simultaneously now (2026-08-31 mechanic change) — there
// is no more single shared "current defender," each side has their own
// zone/eliminated-tiles state. Turn always alternates to the other player
// after every action; what YOUR action must be is derived from whether your
// own zone is currently set (place_zone if not, guess — always targeting
// the opponent's zone — if it is), same derivation the SQL functions use.

export type PvpDuelStatus = 'active' | 'completed' | 'forfeited'

export interface PvpDuel {
  id: string
  playerACharacterId: string
  playerBCharacterId: string
  // Snapshotted at duel-creation time (start_pvp_duel), not looked up live —
  // characters RLS only lets a client see its own account's rows, so a
  // cross-account opponent's name would otherwise silently come back empty
  // (bit Switchee vs Huntard, 2026-08-31 — see the name-snapshot migration).
  playerAName: string | null
  playerBName: string | null
  playerAHp: number
  playerBHp: number
  playerAMaxHp: number
  playerBMaxHp: number
  currentTurnCharacterId: string
  playerAZoneX: number | null
  playerAZoneY: number | null
  playerAEliminatedTiles: number[]
  playerBZoneX: number | null
  playerBZoneY: number | null
  playerBEliminatedTiles: number[]
  turnDeadline: string | null
  turnNumber: number
  winnerCharacterId: string | null
  status: PvpDuelStatus
}

export function toDuel(row: Record<string, unknown>): PvpDuel {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
  return {
    id: row.id as string,
    playerACharacterId: row.player_a_character_id as string,
    playerBCharacterId: row.player_b_character_id as string,
    playerAName: (row.player_a_name as string | null) ?? null,
    playerBName: (row.player_b_name as string | null) ?? null,
    playerAHp: Number(row.player_a_hp),
    playerBHp: Number(row.player_b_hp),
    playerAMaxHp: Number(row.player_a_max_hp),
    playerBMaxHp: Number(row.player_b_max_hp),
    currentTurnCharacterId: row.current_turn_character_id as string,
    playerAZoneX: num(row.player_a_zone_x),
    playerAZoneY: num(row.player_a_zone_y),
    playerAEliminatedTiles: (row.player_a_eliminated_tiles as number[] | null) ?? [],
    playerBZoneX: num(row.player_b_zone_x),
    playerBZoneY: num(row.player_b_zone_y),
    playerBEliminatedTiles: (row.player_b_eliminated_tiles as number[] | null) ?? [],
    turnDeadline: (row.turn_deadline as string | null) ?? null,
    turnNumber: Number(row.turn_number),
    winnerCharacterId: (row.winner_character_id as string | null) ?? null,
    status: row.status as PvpDuelStatus,
  }
}

export function opponentIdFor(duel: PvpDuel, characterId: string): string {
  return duel.playerACharacterId === characterId ? duel.playerBCharacterId : duel.playerACharacterId
}

interface ZoneState {
  zoneX: number | null
  zoneY: number | null
  eliminatedTiles: number[]
}

export function zoneFor(duel: PvpDuel, characterId: string): ZoneState {
  const isA = duel.playerACharacterId === characterId
  return {
    zoneX: isA ? duel.playerAZoneX : duel.playerBZoneX,
    zoneY: isA ? duel.playerAZoneY : duel.playerBZoneY,
    eliminatedTiles: isA ? duel.playerAEliminatedTiles : duel.playerBEliminatedTiles,
  }
}

// Mirrors the SQL functions' own derivation — my required action is
// place_zone if my own zone isn't set, otherwise guess (against the
// opponent's zone).
export function requiredActionFor(duel: PvpDuel, characterId: string): 'place_zone' | 'guess' {
  return zoneFor(duel, characterId).zoneX === null ? 'place_zone' : 'guess'
}

export interface PvpActionResult {
  ok: boolean
  error?: string
  // Only populated for a transport-level failure (rpc_failed) — the
  // Edge Function's own unwrapped error/detail text, so a failure is
  // actionable from the UI alone rather than only visible in Supabase's
  // function logs (see resolve-pvp-duel's own error.context unwrap
  // convention, mirrored below).
  detail?: string
  hit?: boolean
  damageDealt?: number
  forfeited?: boolean
}

interface PvpDuelState {
  duel: PvpDuel | null
  busy: boolean
  setDuel: (duel: PvpDuel | null) => void
  loadActiveDuel: (characterId: string) => Promise<void>
  placeZone: (characterId: string, zoneX: number, zoneY: number, secretTile: number) => Promise<PvpActionResult>
  guess: (characterId: string, tile: number) => Promise<PvpActionResult>
}

async function submitAction(
  duel: PvpDuel | null,
  characterId: string,
  action: Record<string, unknown>,
): Promise<PvpActionResult> {
  if (!duel) {
    return { ok: false, error: 'no_active_duel' }
  }

  const { data, error } = await supabase.functions.invoke('resolve-pvp-duel', {
    body: { duelId: duel.id, characterId, turnNumber: duel.turnNumber, action },
  })

  if (error) {
    // Same error.context unwrap as useZoneBossStore.ts's attack — a non-2xx
    // response only carries the real error/detail fields on the raw
    // Response object, not on `data`.
    let detail: string | undefined
    if ('context' in error && error.context instanceof Response) {
      try {
        const body = await error.context.clone().json()
        detail = body?.error ? `${body.error}${body.detail ? `: ${body.detail}` : ''}` : JSON.stringify(body)
      } catch {
        detail = error.message
      }
    }
    console.error('resolve-pvp-duel call failed', detail ?? error)
    return { ok: false, error: 'rpc_failed', detail }
  }

  const result = data as { ok: boolean; error?: string; hit?: boolean; damage_dealt?: number; forfeited?: boolean; duel?: Record<string, unknown> }

  if (result.duel) {
    usePvpDuelStore.getState().setDuel(toDuel(result.duel))
  }

  return { ok: result.ok, error: result.error, hit: result.hit, damageDealt: result.damage_dealt, forfeited: result.forfeited }
}

export const usePvpDuelStore = create<PvpDuelState>((set, get) => ({
  duel: null,
  busy: false,

  setDuel: (duel) => set({ duel }),

  loadActiveDuel: async (characterId) => {
    const { data, error } = await supabase
      .from('pvp_duels')
      .select('*')
      .or(`player_a_character_id.eq.${characterId},player_b_character_id.eq.${characterId}`)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      console.error('pvp_duels load failed', error)
      return
    }

    set({ duel: data && data.length > 0 ? toDuel(data[0] as Record<string, unknown>) : null })
  },

  placeZone: async (characterId, zoneX, zoneY, secretTile) => {
    if (get().busy) return { ok: false, error: 'busy' }
    set({ busy: true })
    const result = await submitAction(get().duel, characterId, { type: 'place_zone', zone_x: zoneX, zone_y: zoneY, secret_tile: secretTile })
    set({ busy: false })
    return result
  },

  guess: async (characterId, tile) => {
    if (get().busy) return { ok: false, error: 'busy' }
    set({ busy: true })
    const result = await submitAction(get().duel, characterId, { type: 'guess', tile })
    set({ busy: false })
    return result
  },
}))
