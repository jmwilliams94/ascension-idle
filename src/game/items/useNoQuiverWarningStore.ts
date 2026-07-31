import { create } from 'zustand'

// Ephemeral UI signal only, flashed on a blocked attack attempt when a Hunter
// has no Quiver equipped (see useCombatStore.runTick and QuiverWarningHud).
// Renamed/repurposed from the old useOutOfArrowsWarningStore now that the
// arrow-stack ammo economy is gone entirely (2026-07-31) — the Quiver item
// being equipped or not is the only gate left.
interface NoQuiverWarningState {
  // Timestamp of the most recent blocked attack attempt — null means no warning
  // showing. A timestamp rather than a boolean so the HUD's flash can re-trigger on
  // repeated attempts, not just the first.
  triggeredAt: number | null
  trigger: () => void
  clear: () => void
}

export const useNoQuiverWarningStore = create<NoQuiverWarningState>((set) => ({
  triggeredAt: null,
  trigger: () => set({ triggeredAt: Date.now() }),
  clear: () => set({ triggeredAt: null }),
}))
