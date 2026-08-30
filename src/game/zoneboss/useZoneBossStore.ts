import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import type { ZoneBossId } from '../zones/zoneBossData'

// Zone Boss server event (2026-11-13 rework of the original single World
// Boss — see CLAUDE.combat-and-loot.md and plan gentle-plotting-beaver for
// the rotation writeup; tranquil-knitting-acorn for the original design).
// DB tables/RPCs/Edge Function stay named world_boss_* internally (a
// deliberate scope-limiting call, see the plan) — only this store's own
// exported names and the player-facing UI are "Zone Boss." Mirrors
// useLuckyStore.ts's shape (busy-guarded RPC/Edge Function call, server
// response applied absolutely) — the server is the sole source of truth for
// every number here, this store never accumulates damage/HP locally.

export interface ZoneBossSpawn {
  id: string
  bossId: ZoneBossId
  maxHp: number
  currentHp: number
  physicalDefense: number
  magicDefense: number
  // Total reward pool per currency for this spawn (Lottery Ticket/Fallen
  // Star/Comet Scroll today) — computed server-side once at roll time from
  // the boss's zone level, see zone_boss_reward_pool_for_level in the
  // proportional-rewards migration. Keyed by MailCurrencyType, loosely typed
  // here since it's parsed straight from a jsonb column.
  rewardPool: Record<string, number>
  windowStartedAt: string
  windowEndsAt: string
  status: 'active' | 'ended'
}

export interface ZoneBossParticipation {
  freeAttemptsUsed: number
  paidAttemptsUsed: number
  totalDamage: number
  lastAttemptAt: string | null
}

export interface ZoneBossAttackResult {
  ok: boolean
  error?:
    | 'spawn_changed'
    | 'window_ended'
    | 'boss_defeated'
    | 'on_cooldown'
    | 'not_enough_ap'
    | 'no_attempts_remaining'
    | 'damage_cap_reached'
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

function toSpawn(row: Record<string, unknown>): ZoneBossSpawn {
  return {
    id: row.id as string,
    bossId: row.boss_id as ZoneBossId,
    maxHp: Number(row.max_hp),
    currentHp: Number(row.current_hp),
    physicalDefense: Number(row.physical_defense),
    magicDefense: Number(row.magic_defense),
    rewardPool: (row.reward_pool as Record<string, number>) ?? {},
    windowStartedAt: row.window_started_at as string,
    windowEndsAt: row.window_ends_at as string,
    status: row.status as 'active' | 'ended',
  }
}

interface ZoneBossParticipantRow {
  free_attempts_used: number
  paid_attempts_used: number
  total_damage: number
  last_attempt_at: string | null
}

function toParticipation(row: ZoneBossParticipantRow): ZoneBossParticipation {
  return {
    freeAttemptsUsed: row.free_attempts_used,
    paidAttemptsUsed: row.paid_attempts_used,
    totalDamage: row.total_damage,
    lastAttemptAt: row.last_attempt_at,
  }
}

interface ZoneBossState {
  spawn: ZoneBossSpawn | null
  // Null means "never attempted this spawn" — distinct from a zeroed-out
  // ZoneBossParticipation, since attempts-remaining math treats both the
  // same way but the UI needs to tell "no row yet" apart from "loading."
  participation: ZoneBossParticipation | null
  busy: boolean
  setSpawn: (spawn: ZoneBossSpawn) => void
  loadParticipation: (characterId: string, spawnId: string) => Promise<void>
  ensureSpawn: () => Promise<void>
  attack: (characterId: string) => Promise<ZoneBossAttackResult>
}

export const useZoneBossStore = create<ZoneBossState>((set, get) => ({
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

    set({ participation: data ? toParticipation(data as ZoneBossParticipantRow) : null })
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
      // A non-2xx response (the Edge Function's own query_failed/
      // unhandled_exception paths) surfaces here as a bare transport error —
      // `data` is null, and the JSON body (with the real `error`/`detail`
      // fields) is only reachable through error.context (a raw Response),
      // same pattern NotificationsSettingsPanel.tsx already uses, added here
      // 2026-11 (requested by the user — "sometimes my character will attack
      // and other times Something went wrong," with no way to tell which of
      // several possible causes it actually was). This project has no way to
      // tail Edge Function logs from the CLI used to deploy it, so this is
      // the only way to see the real cause of a future occurrence.
      let detail: string | undefined
      if ('context' in error && error.context instanceof Response) {
        try {
          const body = await error.context.clone().json()
          detail = body?.error ? `${body.error}${body.detail ? `: ${body.detail}` : ''}` : JSON.stringify(body)
        } catch {
          detail = error.message
        }
      }
      console.error('world-boss-attack call failed', detail ?? error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as ZoneBossAttackResult

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
