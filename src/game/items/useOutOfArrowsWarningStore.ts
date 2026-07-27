import { create } from 'zustand'

// Ephemeral UI signal only — kept separate from useArrowStore so subscribing to the
// latter for autosave doesn't fire on every blocked-attack flash (see useArrowStore).
interface OutOfArrowsWarningState {
  // Timestamp of the most recent blocked attack attempt — null means no warning
  // showing. A timestamp rather than a boolean so the HUD's flash can re-trigger on
  // repeated attempts, not just the first.
  triggeredAt: number | null
  trigger: () => void
  clear: () => void
}

export const useOutOfArrowsWarningStore = create<OutOfArrowsWarningState>((set) => ({
  triggeredAt: null,
  trigger: () => set({ triggeredAt: Date.now() }),
  clear: () => set({ triggeredAt: null }),
}))
