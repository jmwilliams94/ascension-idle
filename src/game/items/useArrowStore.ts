import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { ARROW_TYPES, type ArrowTypeId } from './arrowTypes'

export const QUIVER_CAPACITY = 3

export interface ArrowStack {
  id: string
  arrowType: ArrowTypeId
  count: number
  // Which of the Quiver's 3 slots (0/1/2) this stack currently occupies, or
  // null if it's sitting loose in the plain Inventory grid. See CLAUDE.md's
  // Quiver note — replaces the earlier single equippedStackId model outright.
  quiverSlot: number | null
}

interface ArrowStackRow {
  id: string
  arrow_type: ArrowTypeId
  count: number
  quiver_slot: number | null
}

// Real multi-stack arrow inventory (arrow_stacks table) — each stack is a discrete
// row capped at its type's stackSize when created/topped-up. Loading a stack into
// the Quiver (quiverSlot 0-2) is what makes it "active" now — combat auto-consumes
// from loaded stacks in slot order, one at a time (see consumeArrow), rather than a
// single equippedStackId pointer. Consumption only updates local state immediately
// (for instant gating feedback); the actual DB counts sync through resolve-combat's
// periodic reconciliation (see resolveCombat.ts) — buying/loading/unloading, by
// contrast, write immediately since they're deliberate one-off commits, same
// pattern as Forge upgrades.
interface ArrowState {
  stacks: ArrowStack[]
  loaded: boolean
  loadStacks: (characterId: string) => Promise<void>
  buyArrows: (characterId: string, type: ArrowTypeId, quantity: number) => Promise<void>
  // Returns whether an arrow was actually consumed — false means the attack should
  // be blocked (no stacks loaded in the Quiver, or all of them are empty). Auto-
  // advances: depletes the lowest-slotted loaded stack first, then rolls onto the
  // next one once it hits 0 — no manual "switch active stack" action needed.
  consumeArrow: () => boolean
  // Reconciles a stack's count with resolve-combat's authoritative response
  // (see resolveCombat.ts) — the server is now the sole real writer of combat-
  // driven arrow depletion, this just syncs the local predictive copy back to it.
  setStackCount: (stackId: string, count: number) => void
  // Permanently removes a stack (used only when the player picks an arrow stack to
  // discard to make room for a full-inventory gear drop — see useInventoryStore's
  // resolvePendingDrop). Unlike normal depletion, this actually deletes the row.
  deleteStack: (stackId: string) => Promise<void>
  // Assigns the first free Quiver slot (0-2) to this stack — a no-op if all 3 are
  // already occupied by other stacks. Writes immediately (deliberate one-off
  // action, same trust tier as buying).
  loadIntoQuiver: (stackId: string) => Promise<void>
  // Clears a stack's quiver slot, returning it to the plain Inventory grid.
  unloadFromQuiver: (stackId: string) => Promise<void>
  // Unloads every currently-loaded stack — called when the Quiver item itself is
  // unequipped, so stacks don't sit silently orphaned (still slotted, but inert
  // since combat gates on having a Quiver equipped at all).
  unloadAllFromQuiver: () => Promise<void>
}

export const useArrowStore = create<ArrowState>((set, get) => ({
  stacks: [],
  loaded: false,

  loadStacks: async (characterId) => {
    const { data, error } = await supabase
      .from('arrow_stacks')
      .select('id, arrow_type, count, quiver_slot')
      .eq('character_id', characterId)

    if (error) {
      console.error('Failed to load arrow stacks', error)
      return
    }

    const stacks = ((data ?? []) as ArrowStackRow[]).map((row) => ({
      id: row.id,
      arrowType: row.arrow_type,
      count: row.count,
      quiverSlot: row.quiver_slot,
    }))

    set({ stacks, loaded: true })
  },

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
      const { data, error } = await supabase
        .from('arrow_stacks')
        .insert(newStackInserts)
        .select('id, arrow_type, count, quiver_slot')

      if (error) {
        console.error('Failed to create arrow stack', error)
      } else {
        insertedStacks = ((data ?? []) as ArrowStackRow[]).map((row) => ({
          id: row.id,
          arrowType: row.arrow_type,
          count: row.count,
          quiverSlot: row.quiver_slot,
        }))
      }
    }

    set({ stacks: [...nextStacks, ...insertedStacks] })
  },

  consumeArrow: () => {
    const { stacks } = get()
    const loaded = stacks
      .filter((stack): stack is ArrowStack & { quiverSlot: number } => stack.quiverSlot !== null)
      .sort((a, b) => a.quiverSlot - b.quiverSlot)

    const target = loaded.find((stack) => stack.count > 0)
    if (!target) {
      return false
    }

    set({
      stacks: stacks.map((stack) => (stack.id === target.id ? { ...stack, count: stack.count - 1 } : stack)),
    })
    return true
  },

  setStackCount: (stackId, count) => {
    set((state) => ({
      stacks: state.stacks.map((stack) => (stack.id === stackId ? { ...stack, count } : stack)),
    }))
  },

  deleteStack: async (stackId) => {
    const { error } = await supabase.from('arrow_stacks').delete().eq('id', stackId)

    if (error) {
      console.error('Failed to delete arrow stack', error)
      return
    }

    set((state) => ({
      stacks: state.stacks.filter((stack) => stack.id !== stackId),
    }))
  },

  loadIntoQuiver: async (stackId) => {
    const { stacks } = get()
    const occupiedSlots = new Set(stacks.map((stack) => stack.quiverSlot).filter((slot): slot is number => slot !== null))

    let freeSlot: number | null = null
    for (let slot = 0; slot < QUIVER_CAPACITY; slot += 1) {
      if (!occupiedSlots.has(slot)) {
        freeSlot = slot
        break
      }
    }

    if (freeSlot === null) {
      return
    }

    const { error } = await supabase.from('arrow_stacks').update({ quiver_slot: freeSlot }).eq('id', stackId)
    if (error) {
      console.error('Failed to load arrow stack into quiver', error)
      return
    }

    set({
      stacks: stacks.map((stack) => (stack.id === stackId ? { ...stack, quiverSlot: freeSlot } : stack)),
    })
  },

  unloadFromQuiver: async (stackId) => {
    const { error } = await supabase.from('arrow_stacks').update({ quiver_slot: null }).eq('id', stackId)
    if (error) {
      console.error('Failed to unload arrow stack from quiver', error)
      return
    }

    set((state) => ({
      stacks: state.stacks.map((stack) => (stack.id === stackId ? { ...stack, quiverSlot: null } : stack)),
    }))
  },

  unloadAllFromQuiver: async () => {
    const loadedIds = get()
      .stacks.filter((stack) => stack.quiverSlot !== null)
      .map((stack) => stack.id)

    if (loadedIds.length === 0) {
      return
    }

    const { error } = await supabase.from('arrow_stacks').update({ quiver_slot: null }).in('id', loadedIds)
    if (error) {
      console.error('Failed to unload arrow stacks from quiver', error)
      return
    }

    set((state) => ({
      stacks: state.stacks.map((stack) => (loadedIds.includes(stack.id) ? { ...stack, quiverSlot: null } : stack)),
    }))
  },
}))
