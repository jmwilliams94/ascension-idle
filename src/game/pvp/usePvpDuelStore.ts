import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// PvP Duel client state — see CLAUDE.md's plan nifty-riding-journal (Phase
// 2). Mirrors public.pvp_duels exactly (20261121000000_pvp_duel_core.sql) —
// this store never computes damage/hit results itself, only ever applies
// whatever resolve-pvp-duel / the realtime subscription (PvpDuelConnection)
// hands back, same "server is the sole source of truth" convention as
// useZoneBossStore.ts.

export type PvpDuelPhase = 'awaiting_zone' | 'awaiting_guess' | 'finished'
export type PvpDuelStatus = 'active' | 'completed' | 'forfeited'

export interface PvpDuel {
  id: string
  playerACharacterId: string
  playerBCharacterId: string
  playerAHp: number
  playerBHp: number
  playerAMaxHp: number
  playerBMaxHp: number
  currentAttackerId: string
  phase: PvpDuelPhase
  zoneOriginX: number | null
  zoneOriginY: number | null
  eliminatedTiles: number[]
  turnDeadline: string | null
  turnNumber: number
  winnerCharacterId: string | null
  status: PvpDuelStatus
}

export function toDuel(row: Record<string, unknown>): PvpDuel {
  return {
    id: row.id as string,
    playerACharacterId: row.player_a_character_id as string,
    playerBCharacterId: row.player_b_character_id as string,
    playerAHp: Number(row.player_a_hp),
    playerBHp: Number(row.player_b_hp),
    playerAMaxHp: Number(row.player_a_max_hp),
    playerBMaxHp: Number(row.player_b_max_hp),
    currentAttackerId: row.current_attacker_id as string,
    phase: row.phase as PvpDuelPhase,
    zoneOriginX: row.zone_origin_x === null || row.zone_origin_x === undefined ? null : Number(row.zone_origin_x),
    zoneOriginY: row.zone_origin_y === null || row.zone_origin_y === undefined ? null : Number(row.zone_origin_y),
    eliminatedTiles: (row.eliminated_tiles as number[] | null) ?? [],
    turnDeadline: (row.turn_deadline as string | null) ?? null,
    turnNumber: Number(row.turn_number),
    winnerCharacterId: (row.winner_character_id as string | null) ?? null,
    status: row.status as PvpDuelStatus,
  }
}

// Derives which of the duel's two characters is currently defending — the
// duel row only stores current_attacker_id, same "derive, don't duplicate"
// approach as the SQL functions.
export function defenderIdFor(duel: PvpDuel): string {
  return duel.currentAttackerId === duel.playerACharacterId ? duel.playerBCharacterId : duel.playerACharacterId
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
