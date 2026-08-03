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
  // Bank Storage's own stone count, per tier (characters.composition_stones_banked)
  // — confirmed with the user, 2026-08-03. A genuinely separate, parallel option
  // to the existing warehouse_points liquidation (transfer_stone, unchanged): a
  // stone banked this way keeps its own tier, shown as an individual non-stacking
  // tile in Storage, same as stones already are in Inventory. Moved between the
  // two via bank_stone_item (see useWarehouseStore), not transfer_stone.
  stonesBanked: CompositionStones
  hydrate: (stones: CompositionStones) => void
  setStones: (stones: CompositionStones) => void
  hydrateBanked: (stonesBanked: CompositionStones) => void
  setStonesBanked: (stonesBanked: CompositionStones) => void
}

export const useCompositionStore = create<CompositionState>((set) => ({
  stones: DEFAULT_STONES,
  stonesBanked: DEFAULT_STONES,
  hydrate: (stones) => set({ stones }),
  setStones: (stones) => set({ stones }),
  hydrateBanked: (stonesBanked) => set({ stonesBanked }),
  setStonesBanked: (stonesBanked) => set({ stonesBanked }),
}))
