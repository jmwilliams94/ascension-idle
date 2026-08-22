import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// Gear Score Snapshot (requested by the user) — equipping a scored piece of
// gear (weapon/ring/necklace/boots/hat/coat; Quiver/Pickaxe are never
// scored) freezes a copy of its scoring-relevant fields onto this character
// server-side (character_gear_snapshots, claim_gear_snapshot). Gear Score
// sums this frozen snapshot, not live equipped state, so taking gear off
// (a Pickaxe swap, bare-handed, whatever) never drops the score by itself —
// only equipping something else in that slot, or someone else successfully
// claiming the same item elsewhere, changes it. See CLAUDE.gear-and-forge.md.
export type ScoredSlot = 'weapon' | 'ring' | 'necklace' | 'boots' | 'hat' | 'coat'

export interface GearSnapshotEntry {
  item_id: string
  template_id: string
  quality_tier: string
  level: number
  composition_level: number
  sockets: (null | string)[]
  enchant: { hp?: number; blessPct?: number } | null
}

export interface ClaimSnapshotResult {
  ok: boolean
  error?: string
  claimed_by_character_name?: string
  transferred_from?: string | null
}

interface GearSnapshotState {
  snapshots: Partial<Record<ScoredSlot, GearSnapshotEntry>>
  loadSnapshots: (characterId: string) => Promise<void>
  // Claims (or, with force, transfers) the snapshot for one scored slot.
  // Called right after setEquippedItem — equipping already happened
  // regardless of the outcome here (see the user's own "it equips anyway"
  // clarification); this only decides who gets credit for it.
  claimSnapshot: (characterId: string, slot: ScoredSlot, itemId: string, force?: boolean) => Promise<ClaimSnapshotResult>
}

export const useGearSnapshotStore = create<GearSnapshotState>((set, get) => ({
  snapshots: {},

  loadSnapshots: async (characterId) => {
    const { data, error } = await supabase.rpc('get_my_gear_snapshots', { p_character_id: characterId })

    if (error) {
      console.error('get_my_gear_snapshots call failed', error)
      return
    }

    const result = data as { ok: boolean; snapshots?: Partial<Record<ScoredSlot, GearSnapshotEntry>> }
    if (result.ok && result.snapshots) {
      set({ snapshots: result.snapshots })
    }
  },

  claimSnapshot: async (characterId, slot, itemId, force = false) => {
    const { data, error } = await supabase.rpc('claim_gear_snapshot', {
      p_character_id: characterId,
      p_slot: slot,
      p_item_id: itemId,
      p_force: force,
    })

    if (error) {
      console.error('claim_gear_snapshot call failed', error)
      return { ok: false }
    }

    const result = data as ClaimSnapshotResult
    if (result.ok) {
      // Re-fetch rather than patch locally — a single cheap RPC call, and
      // always correct (e.g. picks up the fields the server actually froze).
      await get().loadSnapshots(characterId)
    }

    return result
  },
}))
