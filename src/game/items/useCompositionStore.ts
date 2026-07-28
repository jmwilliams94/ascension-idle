import { create } from 'zustand'

// Per-character stone stacks (characters.composition_stones jsonb), keyed by tier
// "1".."4" as strings (jsonb object keys are always strings). Same trust model as
// meteors/dragonballs (see useCurrencyStore) — deliberately NOT wired into
// usePersistGameState's autosave, since composition_feed already deducts these
// server-side in the same transaction as the item write. The client only ever
// reads them (on load, and from each composition_feed response).
export type CompositionStones = Record<string, number>

const DEFAULT_STONES: CompositionStones = { '1': 0, '2': 0, '3': 0, '4': 0 }

interface CompositionState {
  stones: CompositionStones
  hydrate: (stones: CompositionStones) => void
  setStones: (stones: CompositionStones) => void
}

export const useCompositionStore = create<CompositionState>((set) => ({
  stones: DEFAULT_STONES,
  hydrate: (stones) => set({ stones }),
  setStones: (stones) => set({ stones }),
}))
