import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'

// World Boss server event — see CLAUDE.combat-and-loot.md and plan
// tranquil-knitting-acorn for the full design writeup. Mirrors
// useLuckyStore.ts's shape (busy-guarded RPC/Edge Function call, server
// response applied absolutely) — the server is the sole source of truth for
// every number here, this store never accumulates damage/HP locally.

export interface WorldBossSpawn {
  id: string
  maxHp: number
  currentHp: number
  windowStartedAt: string
  windowEndsAt: string
  status: 'active' | 'ended'
}

export interface WorldBossParticipation {
  freeAttemptsUsed: number
  paidAttemptsUsed: number
  totalDamage: number
  lastAttemptAt: string | null
}

export interface WorldBossAttackResult {
  ok: boolean
  error?:
    | 'spawn_changed'
    | 'window_ended'
    | 'boss_defeated'
    | 'on_cooldown'
    | 'not_enough_ap'
    | 'no_attempts_remaining'
    | 'quiver_required'
    | 'not_owner'
    | 'rpc_failed'
  damage?: number
  boss_current_hp?: number
  boss_max_hp?: number
  boss_defeated?: boolean
  free_attempts_used?: number
  paid_attempts_used?: number
  ascension_points?: number
  cooldown_ends_at?: string
  window_ends_at?: string
  payment?: 'free' | 'paid'
}

function toSpawn(row: Record<string, unknown>): WorldBossSpawn {
  return {
    id: row.id as string,
    maxHp: Number(row.max_hp),
    currentHp: Number(row.current_hp),
    windowStartedAt: row.window_started_at as string,
    windowEndsAt: row.window_ends_at as string,
    status: row.status as 'active' | 'ended',
  }
}

interface WorldBossParticipantRow {
  free_attempts_used: number
  paid_attempts_used: number
  total_damage: number
  last_attempt_at: string | null
}

function toParticipation(row: WorldBossParticipantRow): WorldBossParticipation {
  return {
    freeAttemptsUsed: row.free_attempts_used,
    paidAttemptsUsed: row.paid_attempts_used,
    totalDamage: row.total_damage,
    lastAttemptAt: row.last_attempt_at,
  }
}

interface WorldBossState {
  spawn: WorldBossSpawn | null
  // Null means "never attempted this spawn" — distinct from a zeroed-out
  // WorldBossParticipation, since attempts-remaining math treats both the
  // same way but the UI needs to tell "no row yet" apart from "loading."
  participation: WorldBossParticipation | null
  busy: boolean
  setSpawn: (spawn: WorldBossSpawn) => void
  loadParticipation: (characterId: string, spawnId: string) => Promise<void>
  ensureSpawn: () => Promise<void>
  attack: (characterId: string) => Promise<WorldBossAttackResult>
}

export const useWorldBossStore = create<WorldBossState>((set, get) => ({
  spawn: null,
  participation: null,
  busy: false,

  setSpawn: (spawn) => set({ spawn }),

  loadParticipation: async (characterId, spawnId) => {
    const { data, error } = await supabase
      .from('world_boss_participants')
      .select('free_attempts_used, paid_attempts_used, total_damage, last_attempt_at')
      .eq('character_id', characterId)
      .eq('spawn_id', spawnId)
      .maybeSingle()

    if (error) {
      console.error('world_boss_participants load failed', error)
      return
    }

    set({ participation: data ? toParticipation(data as WorldBossParticipantRow) : null })
  },

  ensureSpawn: async () => {
    const { data, error } = await supabase.rpc('ensure_world_boss_spawn')
    if (error) {
      console.error('ensure_world_boss_spawn call failed', error)
      return
    }
    const result = data as { ok: boolean; spawn?: Record<string, unknown> }
    if (result.ok && result.spawn) {
      set({ spawn: toSpawn(result.spawn) })
    }
  },

  attack: async (characterId) => {
    if (get().busy) {
      return { ok: false, error: 'rpc_failed' }
    }

    set({ busy: true })
    const { data, error } = await supabase.functions.invoke('world-boss-attack', {
      body: { characterId },
    })
    set({ busy: false })

    if (error) {
      console.error('world-boss-attack call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as WorldBossAttackResult

    if (result.ok) {
      const current = get().spawn
      if (current && typeof result.boss_current_hp === 'number') {
        // status is untouched here — it only ever transitions inside
        // ensure_world_boss_spawn (window expiry), never on HP hitting 0 —
        // a dead-but-still-in-window boss is a valid state per the spec.
        set({ spawn: { ...current, currentHp: result.boss_current_hp } })
      }

      if (typeof result.free_attempts_used === 'number' && typeof result.paid_attempts_used === 'number') {
        set({
          participation: {
            freeAttemptsUsed: result.free_attempts_used,
            paidAttemptsUsed: result.paid_attempts_used,
            totalDamage: (get().participation?.totalDamage ?? 0) + (result.damage ?? 0),
            lastAttemptAt: new Date().toISOString(),
          },
        })
      }

      if (typeof result.ascension_points === 'number') {
        usePlayerRecordStore.getState().setAscensionPoints(result.ascension_points)
      }
    }

    return result
  },
}))
