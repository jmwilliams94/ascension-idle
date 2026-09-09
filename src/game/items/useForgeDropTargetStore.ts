import { create } from 'zustand'

// Desktop UI overhaul (2026-09-09): the 40-slot Inventory grid no longer
// lives inside each Forge sub-panel (Standard/Master/Composition/Salvage/
// Sockets/Enchantress) — it's now one persistent grid in GameShell's right
// column (see GameShell.tsx), shared across every tab. Forge's own material/
// upgrade/socket slots still need to know which tile was just dragged onto
// them, though, and that differs per sub-panel and per selection state — so
// whichever Forge sub-panel is currently mounted registers its own
// onTileDrop/reservedItemIds/isTileEligible here, and the persistent grid
// just reads whatever's currently registered. Only one Forge sub-panel is
// ever mounted at a time (see ForgePanel.tsx's switch), so there's no
// contention between panels. Mobile is unaffected — each sub-panel still
// renders its own local (lg:hidden) Inventory grid wired directly, same as
// before this change.
export interface ForgeDropTarget {
  onTileDrop: (overTarget: string, id: string) => void
  reservedItemIds: string[]
  isTileEligible?: (dragId: string) => boolean
}

interface ForgeDropTargetState {
  target: ForgeDropTarget | null
  setForgeDropTarget: (target: ForgeDropTarget) => void
  clearForgeDropTarget: () => void
}

export const useForgeDropTargetStore = create<ForgeDropTargetState>((set) => ({
  target: null,
  setForgeDropTarget: (target) => set({ target }),
  clearForgeDropTarget: () => set({ target: null }),
}))
