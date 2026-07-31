import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useCombatStore } from '../combat/useCombatStore'
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
  buyPotions: (characterId: string, type: PotionTypeId, quantity: number) => Promise<void>
  // Consumes one potion from the stack. For an 'hp' potion, also heals the
  // player via useCombatStore.healPlayerHp. 'mp' potions have nothing to
  // restore into yet (no ability/skill system exists) — the UI disables Use
  // for them entirely, so this is never called with an 'mp' stack in
  // practice, but stays honest (no-op heal) if it ever were.
  usePotion: (stackId: string) => Promise<void>
  // Permanently removes a stack — used only when discarding to make room for
  // a full-inventory gear drop (see useInventoryStore.resolvePendingDrop).
  deleteStack: (stackId: string) => Promise<void>
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
    const stackSize = POTION_TYPES[type].stackSize
    let remaining = quantity

    const { stacks } = get()
    const nextStacks = stacks.map((stack) => ({ ...stack }))
    const stackUpdates: { id: string; count: number }[] = []

    for (const stack of nextStacks) {
      if (remaining <= 0) break
      if (stack.potionType !== type || stack.count >= stackSize) continue

      const add = Math.min(stackSize - stack.count, remaining)
      stack.count += add
      remaining -= add
      stackUpdates.push({ id: stack.id, count: stack.count })
    }

    const newStackInserts: { character_id: string; potion_type: PotionTypeId; count: number }[] = []
    while (remaining > 0) {
      const count = Math.min(stackSize, remaining)
      remaining -= count
      newStackInserts.push({ character_id: characterId, potion_type: type, count })
    }

    for (const update of stackUpdates) {
      const { error } = await supabase.from('potion_stacks').update({ count: update.count }).eq('id', update.id)
      if (error) {
        console.error('Failed to update potion stack', error)
      }
    }

    let insertedStacks: PotionStack[] = []
    if (newStackInserts.length > 0) {
      const { data, error } = await supabase.from('potion_stacks').insert(newStackInserts).select('id, potion_type, count')

      if (error) {
        console.error('Failed to create potion stack', error)
      } else {
        insertedStacks = ((data ?? []) as PotionStackRow[]).map((row) => ({
          id: row.id,
          potionType: row.potion_type,
          count: row.count,
        }))
      }
    }

    set({ stacks: [...nextStacks, ...insertedStacks] })
  },

  usePotion: async (stackId) => {
    const { stacks } = get()
    const stack = stacks.find((entry) => entry.id === stackId)

    if (!stack || stack.count <= 0) {
      return
    }

    const type = POTION_TYPES[stack.potionType]
    const nextCount = stack.count - 1

    set({ stacks: stacks.map((entry) => (entry.id === stackId ? { ...entry, count: nextCount } : entry)) })

    if (type.kind === 'hp') {
      useCombatStore.getState().healPlayerHp(type.healAmount)
    }

    const { error } = await supabase.from('potion_stacks').update({ count: nextCount }).eq('id', stackId)
    if (error) {
      console.error('Failed to save potion use', error)
    }
  },

  deleteStack: async (stackId) => {
    const { error } = await supabase.from('potion_stacks').delete().eq('id', stackId)

    if (error) {
      console.error('Failed to delete potion stack', error)
      return
    }

    set((state) => ({ stacks: state.stacks.filter((stack) => stack.id !== stackId) }))
  },
}))
