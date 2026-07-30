import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { ARROW_TYPES, type ArrowTypeId } from './arrowTypes'

export interface ArrowStack {
  id: string
  arrowType: ArrowTypeId
  count: number
}

interface ArrowStackRow {
  id: string
  arrow_type: ArrowTypeId
  count: number
}

// Real multi-stack arrow inventory (arrow_stacks table) — each stack is a discrete
// row capped at its type's stackSize when created/topped-up. Equipping targets a
// specific stack (equippedStackId), not just a type: depleting the equipped stack
// never touches any other stack of the same type sitting in inventory. Consumption
// only updates local state immediately (for instant gating feedback); the actual DB
// counts sync through the normal debounced autosave (saveStackCounts), same as
// gold/exp — buying, by contrast, writes immediately since it's a deliberate
// one-off commit, same pattern as Forge upgrades.
interface ArrowState {
  stacks: ArrowStack[]
  equippedStackId: string | null
  loaded: boolean
  loadStacks: (characterId: string) => Promise<void>
  // Hydrates the equipped pointer only — called by useCharacterRecordStore, which
  // reads it off the characters row (loadStacks handles the stacks themselves).
  setEquippedStackId: (stackId: string | null) => void
  buyArrows: (characterId: string, type: ArrowTypeId, quantity: number) => Promise<void>
  // Returns whether an arrow was actually consumed — false means the attack should
  // be blocked (no equipped stack, or it's empty). This is now purely a local,
  // predictive gate for instant visual feedback — see CombatEngine.tsx/
  // resolveCombat.ts, which no longer let this store's own autosave write real
  // arrow counts (combat depletion is server-authoritative now).
  consumeArrow: () => boolean
  // Reconciles a stack's count with resolve-combat's authoritative response
  // (see resolveCombat.ts) — the server is now the sole real writer of combat-
  // driven arrow depletion, this just syncs the local predictive copy back to it.
  setStackCount: (stackId: string, count: number) => void
  saveStackCounts: (characterId: string) => Promise<void>
  // Permanently removes a stack (used only when the player picks an arrow stack to
  // discard to make room for a full-inventory gear drop — see useInventoryStore's
  // resolvePendingDrop). Unlike normal depletion, this actually deletes the row.
  deleteStack: (stackId: string) => Promise<void>
}

export const useArrowStore = create<ArrowState>((set, get) => ({
  stacks: [],
  equippedStackId: null,
  loaded: false,

  loadStacks: async (characterId) => {
    const { data, error } = await supabase
      .from('arrow_stacks')
      .select('id, arrow_type, count')
      .eq('character_id', characterId)

    if (error) {
      console.error('Failed to load arrow stacks', error)
      return
    }

    const stacks = ((data ?? []) as ArrowStackRow[]).map((row) => ({
      id: row.id,
      arrowType: row.arrow_type,
      count: row.count,
    }))

    set({ stacks, loaded: true })
  },

  setEquippedStackId: (stackId) => set({ equippedStackId: stackId }),

  buyArrows: async (characterId, type, quantity) => {
    const stackSize = ARROW_TYPES[type].stackSize
    let remaining = quantity

    const { stacks } = get()
    const nextStacks = stacks.map((stack) => ({ ...stack }))
    const stackUpdates: { id: string; count: number }[] = []

    // Top up existing non-full stacks of this type before creating new ones.
    for (const stack of nextStacks) {
      if (remaining <= 0) break
      if (stack.arrowType !== type || stack.count >= stackSize) continue

      const add = Math.min(stackSize - stack.count, remaining)
      stack.count += add
      remaining -= add
      stackUpdates.push({ id: stack.id, count: stack.count })
    }

    const newStackInserts: { character_id: string; arrow_type: ArrowTypeId; count: number }[] = []
    while (remaining > 0) {
      const count = Math.min(stackSize, remaining)
      remaining -= count
      newStackInserts.push({ character_id: characterId, arrow_type: type, count })
    }

    for (const update of stackUpdates) {
      const { error } = await supabase.from('arrow_stacks').update({ count: update.count }).eq('id', update.id)
      if (error) {
        console.error('Failed to update arrow stack', error)
      }
    }

    let insertedStacks: ArrowStack[] = []
    if (newStackInserts.length > 0) {
      const { data, error } = await supabase.from('arrow_stacks').insert(newStackInserts).select('id, arrow_type, count')

      if (error) {
        console.error('Failed to create arrow stack', error)
      } else {
        insertedStacks = ((data ?? []) as ArrowStackRow[]).map((row) => ({
          id: row.id,
          arrowType: row.arrow_type,
          count: row.count,
        }))
      }
    }

    set({ stacks: [...nextStacks, ...insertedStacks] })
  },

  consumeArrow: () => {
    const { stacks, equippedStackId } = get()

    if (!equippedStackId) {
      return false
    }

    const index = stacks.findIndex((stack) => stack.id === equippedStackId)

    if (index === -1 || stacks[index].count <= 0) {
      return false
    }

    const nextStacks = [...stacks]
    nextStacks[index] = { ...nextStacks[index], count: nextStacks[index].count - 1 }
    set({ stacks: nextStacks })
    return true
  },

  setStackCount: (stackId, count) => {
    set((state) => ({
      stacks: state.stacks.map((stack) => (stack.id === stackId ? { ...stack, count } : stack)),
    }))
  },

  saveStackCounts: async (characterId) => {
    const { stacks } = get()

    if (stacks.length === 0) {
      return
    }

    const { error } = await supabase.from('arrow_stacks').upsert(
      stacks.map((stack) => ({
        id: stack.id,
        character_id: characterId,
        arrow_type: stack.arrowType,
        count: stack.count,
      })),
    )

    if (error) {
      console.error('Failed to save arrow stack counts', error)
    }
  },

  deleteStack: async (stackId) => {
    const { error } = await supabase.from('arrow_stacks').delete().eq('id', stackId)

    if (error) {
      console.error('Failed to delete arrow stack', error)
      return
    }

    set((state) => ({
      stacks: state.stacks.filter((stack) => stack.id !== stackId),
      equippedStackId: state.equippedStackId === stackId ? null : state.equippedStackId,
    }))
  },
}))
