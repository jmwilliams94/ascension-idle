import { create } from 'zustand'
import type { GemCounts } from './gemTypes'

// Per-character gem counts (characters.gems jsonb), keyed by "<gemId>_<tier>"
// (see gemStorageKey in gemTypes.ts) — same fungible-count shape as
// useCompositionStore's stones. First real hydration/write path for this
// column (Lucky Lad rewards expansion, 2026-08-09) — gemTypes.ts was
// previously entirely inert. Same server-authoritative trust model as
// comets/fallen stars/stones: deliberately NOT wired into usePersistGameState's
// autosave, since draw_lucky_ticket/open_reward_item already write this
// column server-side in the same transaction as the grant.
const DEFAULT_GEMS: GemCounts = {}

interface GemState {
  gems: GemCounts
  hydrate: (gems: GemCounts) => void
  setGems: (gems: GemCounts) => void
}

export const useGemStore = create<GemState>((set) => ({
  gems: DEFAULT_GEMS,
  hydrate: (gems) => set({ gems: gems ?? DEFAULT_GEMS }),
  setGems: (gems) => set({ gems: gems ?? DEFAULT_GEMS }),
}))
