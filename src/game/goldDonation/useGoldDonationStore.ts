import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'

// Gold Donation Event server event — see CLAUDE.server-events.md for the
// full design writeup. Mirrors useWorldBossStore.ts's shape (busy-guarded
// RPC call, server response applied absolutely) — the server is the sole
// source of truth for the pool/buff state, this store never accumulates
// donation totals locally.

export type GoldDonationBuffCategory = 'exp' | 'socket_unlock' | 'comet' | 'fallen_star' | 'quality_tier'

export interface GoldDonationPool {
  id: string
  targetAmount: number
  totalDonated: number
  status: 'collecting' | 'active' | 'ended'
  buffCategory: GoldDonationBuffCategory | null
  buffMultiplier: number | null
  buffStartedAt: string | null
  buffEndsAt: string | null
}

export interface GoldDonationParticipation {
  totalDonated: number
  lastDonatedAt: string | null
}

export interface GoldDonationResult {
  ok: boolean
  error?: 'invalid_amount' | 'not_owner' | 'not_enough_gold' | 'pool_not_collecting' | 'rpc_failed'
  gold?: number
  gold_remaining?: number
  pool_total_donated?: number
  pool_target?: number
  triggered_buff?: boolean
  participant_total_donated?: number
}

// Active buff (if any) as of `nowMs` — a plain helper rather than a store
// field, so it's never a stale/redundant `now`-driven field on the store
// itself (same "no fresh literal from a selector" rule as elsewhere in this
// codebase — callers pass their own tick in).
export function getActiveGoldDonationEvent(
  pool: GoldDonationPool | null,
  nowMs: number,
): { category: GoldDonationBuffCategory; multiplier: number } | null {
  if (!pool || pool.status !== 'active' || !pool.buffCategory || !pool.buffMultiplier || !pool.buffEndsAt) {
    return null
  }
  if (new Date(pool.buffEndsAt).getTime() <= nowMs) {
    return null
  }
  return { category: pool.buffCategory, multiplier: pool.buffMultiplier }
}

function toPool(row: Record<string, unknown>): GoldDonationPool {
  return {
    id: row.id as string,
    targetAmount: Number(row.target_amount),
    totalDonated: Number(row.total_donated),
    status: row.status as GoldDonationPool['status'],
    buffCategory: (row.buff_category as GoldDonationBuffCategory | null) ?? null,
    buffMultiplier: row.buff_multiplier === null || row.buff_multiplier === undefined ? null : Number(row.buff_multiplier),
    buffStartedAt: (row.buff_started_at as string | null) ?? null,
    buffEndsAt: (row.buff_ends_at as string | null) ?? null,
  }
}

interface GoldDonationParticipantRow {
  total_donated: number
  last_donated_at: string | null
}

function toParticipation(row: GoldDonationParticipantRow): GoldDonationParticipation {
  return {
    totalDonated: row.total_donated,
    lastDonatedAt: row.last_donated_at,
  }
}

interface GoldDonationState {
  pool: GoldDonationPool | null
  // Null means "never donated to this pool" — distinct from a zeroed-out
  // GoldDonationParticipation, same "no row yet" vs "loading" distinction as
  // useWorldBossStore's participation field.
  participation: GoldDonationParticipation | null
  busy: boolean
  setPool: (pool: GoldDonationPool) => void
  loadParticipation: (characterId: string, poolId: string) => Promise<void>
  ensurePool: () => Promise<void>
  donate: (characterId: string, amount: number) => Promise<GoldDonationResult>
}

export const useGoldDonationStore = create<GoldDonationState>((set, get) => ({
  pool: null,
  participation: null,
  busy: false,

  setPool: (pool) => set({ pool }),

  loadParticipation: async (characterId, poolId) => {
    const { data, error } = await supabase
      .from('gold_donation_participants')
      .select('total_donated, last_donated_at')
      .eq('character_id', characterId)
      .eq('pool_id', poolId)
      .maybeSingle()

    if (error) {
      console.error('gold_donation_participants load failed', error)
      return
    }

    set({ participation: data ? toParticipation(data as GoldDonationParticipantRow) : null })
  },

  ensurePool: async () => {
    const { data, error } = await supabase.rpc('ensure_gold_donation_pool')
    if (error) {
      console.error('ensure_gold_donation_pool call failed', error)
      return
    }
    const result = data as { ok: boolean; pool?: Record<string, unknown> }
    if (result.ok && result.pool) {
      set({ pool: toPool(result.pool) })
    }
  },

  donate: async (characterId, amount) => {
    if (get().busy) {
      return { ok: false, error: 'rpc_failed' }
    }

    set({ busy: true })
    const { data, error } = await supabase.rpc('donate_gold', { p_character_id: characterId, p_amount: amount })
    set({ busy: false })

    if (error) {
      console.error('donate_gold call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as GoldDonationResult

    if (result.ok) {
      // Pool state itself refreshes via GoldDonationConnection's Realtime
      // subscription, not set locally here — same "server is sole source of
      // truth" convention as useWorldBossStore.attack(). Only the
      // character's own gold balance needs an immediate local update (the
      // server round-trip already returned it).
      if (typeof result.gold_remaining === 'number') {
        useProgressionStore.getState().setGold(result.gold_remaining)
      }
      if (typeof result.participant_total_donated === 'number') {
        set({
          participation: {
            totalDonated: result.participant_total_donated,
            lastDonatedAt: new Date().toISOString(),
          },
        })
      }
    }

    return result
  },
}))
