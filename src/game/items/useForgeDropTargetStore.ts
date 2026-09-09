import { useEffect, useRef } from 'react'
import { create } from 'zustand'

// Desktop UI overhaul (2026-09-09): the 40-slot Inventory grid no longer
// lives inside each Forge sub-panel (Standard/Master/Composition/Salvage/
// Sockets/Enchantress) — it's now one persistent grid in GameShell's right
// column (see GameShell.tsx), shared across every tab. Forge's own material/
// upgrade/socket slots still need to know which tile was just dragged onto
// them, though, and that differs per sub-panel and per selection state — so
// whichever Forge sub-panel is currently mounted registers its own
// onTileDrop/reservedItemIds/isTileEligible here (via useRegisterForgeDropTarget
// below), and the persistent grid just reads whatever's currently registered.
// Only one Forge sub-panel is ever mounted at a time (see ForgePanel.tsx's
// switch), so there's no contention between panels. Mobile is unaffected —
// each sub-panel still renders its own local (lg:hidden) Inventory grid
// wired directly, same as before this change.
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

// Bug fix (2026-09-09, reported by the user: every Forge sub-panel rendered
// a blank screen) — the first version of this registration had each
// sub-panel call setForgeDropTarget from a useEffect with NO dependency
// array (to keep onTileDrop/isTileEligible's closures fresh every render).
// That re-ran the effect on literally every render, which changes this
// store's `target` reference every time — GameShell subscribes to `target`
// to feed the persistent grid, so it re-rendered on every store update,
// which re-rendered the (non-memoized) Forge sub-panel as its child, which
// re-ran the effect again, forever: an infinite render loop that crashed to
// a blank screen before anything ever painted.
//
// This hook fixes both problems: onTileDrop/isTileEligible are stashed in
// refs, updated on every render (a plain ref mutation, not a state update —
// doesn't itself trigger anything) so the registered wrapper functions are
// always calling the latest closure without the *store* needing to change.
// The store is only actually touched when the *set of reserved ids* changes
// (compared by content, not by the fresh array reference each caller passes
// in every render) — a real, bounded, user-driven change, not a per-render
// churn, so the effect fires a fixed number of times instead of forever.
export function useRegisterForgeDropTarget(
  onTileDrop: (overTarget: string, id: string) => void,
  isTileEligible: ((dragId: string) => boolean) | undefined,
  reservedItemIds: string[],
) {
  const onTileDropRef = useRef(onTileDrop)
  onTileDropRef.current = onTileDrop
  const isTileEligibleRef = useRef(isTileEligible)
  isTileEligibleRef.current = isTileEligible

  const reservedKey = reservedItemIds.join(',')

  useEffect(() => {
    useForgeDropTargetStore.getState().setForgeDropTarget({
      onTileDrop: (overTarget, id) => onTileDropRef.current(overTarget, id),
      isTileEligible: (dragId) => (isTileEligibleRef.current ? isTileEligibleRef.current(dragId) : true),
      reservedItemIds,
    })
    return () => useForgeDropTargetStore.getState().clearForgeDropTarget()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reservedKey is
    // reservedItemIds' own content-based dependency, see the doc comment above.
  }, [reservedKey])
}
