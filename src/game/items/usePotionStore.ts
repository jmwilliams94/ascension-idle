import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useActiveCharacterStore } from '../../lib/useActiveCharacterStore'
import { useCombatStore } from '../combat/useCombatStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { POTION_TYPES, type PotionTypeId } from './potionTypes'

export interface PotionStack {
  id: string
  potionType: PotionTypeId
  count: number
}

interface PotionStackRow {
  id: string
  potion_type: PotionTypeId
  count: number
}

// Real discrete stack rows, capped per type, topped-up on purchase before a
// new stack is created. Potions are manual-use only, not consumed by the
// combat tick loop, so Use is a deliberate one-off action that writes to the
// DB immediately (same trust tier as buying) rather than only updating local
// state for the debounced autosave to pick up later.
interface PotionState {
  stacks: PotionStack[]
  loaded: boolean
  loadStacks: (characterId: string) => Promise<void>
  // Routed through the shop_buy_potion RPC (see migration
  // 20260821000000_lock_down_direct_table_writes.sql) — potion_stacks has no
  // direct client INSERT/UPDATE grant anymore, so cost/level validation and
  // the actual stack top-up/creation happen server-side in one transaction.
  buyPotions: (characterId: string, type: PotionTypeId, quantity: number) => Promise<{ ok: boolean; error?: string }>
  // Consumes one potion from the stack. For an 'hp' potion, heals the player
  // via useCombatStore.healPlayerHp; for an 'mp' potion, restores MP via
  // useCombatStore.restorePlayerMp (real as of the skill-equip system, see
  // CLAUDE.combat-and-loot.md — Mana potions were shipped inert ahead of it).
  usePotion: (stackId: string) => Promise<void>
}

export const usePotionStore = create<PotionState>((set, get) => ({
  stacks: [],
  loaded: false,

  loadStacks: async (characterId) => {
    const { data, error } = await supabase
      .from('potion_stacks')
      .select('id, potion_type, count')
      .eq('character_id', characterId)

    if (error) {
      console.error('Failed to load potion stacks', error)
      return
    }

    const stacks = ((data ?? []) as PotionStackRow[]).map((row) => ({
      id: row.id,
      potionType: row.potion_type,
      count: row.count,
    }))

    set({ stacks, loaded: true })
  },

  buyPotions: async (characterId, type, quantity) => {
    const { data, error } = await supabase.rpc('shop_buy_potion', {
      p_character_id: characterId,
      p_potion_type: type,
      p_quantity: quantity,
    })

    if (error) {
      console.error('Potion purchase failed', error)
      return { ok: false }
    }

    const result = data as { ok: boolean; error?: string; gold?: number }

    if (!result.ok) {
      return { ok: false, error: result.error }
    }

    if (typeof result.gold === 'number') {
      useProgressionStore.getState().setGold(result.gold)
    }

    // The RPC already wrote the real stacks server-side (topped up existing
    // ones, created new ones as needed) — refetch rather than reconstruct
    // that locally, since which stacks got new rows isn't returned.
    await get().loadStacks(characterId)
    return { ok: true }
  },

  usePotion: async (stackId) => {
    const characterId = useActiveCharacterStore.getState().characterId
    const { stacks } = get()
    const stack = stacks.find((entry) => entry.id === stackId)

    if (!characterId || !stack || stack.count <= 0) {
      return
    }

    const type = POTION_TYPES[stack.potionType]
    const nextCount = stack.count - 1

    // Optimistic — heals/decrements immediately for responsiveness, then
    // reconciles against the RPC's authoritative count (potion_stacks has no
    // direct client UPDATE grant anymore, see use_potion_stack in migration
    // 20260821000000_lock_down_direct_table_writes.sql).
    set({ stacks: stacks.map((entry) => (entry.id === stackId ? { ...entry, count: nextCount } : entry)) })

    if (type.kind === 'hp') {
      useCombatStore.getState().healPlayerHp(type.healAmount)
    } else {
      useCombatStore.getState().restorePlayerMp(type.healAmount)
    }

    const { data, error } = await supabase.rpc('use_potion_stack', { p_stack_id: stackId, p_character_id: characterId })

    if (error) {
      console.error('Failed to save potion use', error)
      return
    }

    const result = data as { ok: boolean; error?: string; count?: number }
    if (!result.ok || typeof result.count !== 'number') {
      console.error('Potion use rejected', result.error)
      return
    }

    set((state) => ({ stacks: state.stacks.map((entry) => (entry.id === stackId ? { ...entry, count: result.count! } : entry)) }))
  },
}))
