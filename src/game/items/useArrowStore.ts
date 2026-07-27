import { create } from 'zustand'
import { createEmptyArrowCounts, type ArrowTypeId } from './arrowTypes'

// Purely the persisted ammo data — the ephemeral "just tried to attack with no
// ammo" warning signal lives in useOutOfArrowsWarningStore instead, so this store
// can be subscribed to for autosave without firing on every blocked-attack flash
// (which changes far more often than the actual arrows/equipped type).
interface ArrowState {
  arrows: Record<ArrowTypeId, number>
  equippedArrowType: ArrowTypeId | null
  hydrate: (saved: { arrows: Record<string, number>; equippedArrowType: ArrowTypeId | null }) => void
  setEquippedArrowType: (type: ArrowTypeId | null) => void
  addArrows: (type: ArrowTypeId, count: number) => void
  // Returns whether an arrow was actually consumed — false means the attack should
  // be blocked (no equipped type, or none remaining).
  consumeArrow: () => boolean
}

export const useArrowStore = create<ArrowState>((set, get) => ({
  arrows: createEmptyArrowCounts(),
  equippedArrowType: null,

  hydrate: (saved) => {
    const defaults = createEmptyArrowCounts()
    set({
      // Defensively coalesce missing keys to 0 (e.g. jsonb from an older row shape)
      // rather than letting undefined leak into arithmetic elsewhere.
      arrows: { ...defaults, ...saved.arrows },
      equippedArrowType: saved.equippedArrowType,
    })
  },

  setEquippedArrowType: (type) => set({ equippedArrowType: type }),

  addArrows: (type, count) =>
    set((state) => ({ arrows: { ...state.arrows, [type]: state.arrows[type] + count } })),

  consumeArrow: () => {
    const { equippedArrowType, arrows } = get()

    if (!equippedArrowType || arrows[equippedArrowType] <= 0) {
      return false
    }

    set({ arrows: { ...arrows, [equippedArrowType]: arrows[equippedArrowType] - 1 } })
    return true
  },
}))
