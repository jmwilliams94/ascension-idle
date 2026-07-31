import { create } from 'zustand'

// Ephemeral UI signal only, flashed when a live resolve-combat response
// reports inventoryFull (see resolveCombat.ts and useCombatStore.stopForInventoryFull) —
// mirrors useNoQuiverWarningStore's exact shape. InventoryFullWarningHud shows
// a steady warning independent of this (whenever occupiedSlotCount is at
// cap), this only drives the brief red flash on the moment combat actually
// stopped for it.
interface InventoryFullWarningState {
  // Timestamp of the most recent stop-for-inventory-full event — null means
  // no flash showing. A timestamp rather than a boolean so the HUD's flash
  // can re-trigger on repeated events, not just the first.
  triggeredAt: number | null
  trigger: () => void
  clear: () => void
}

export const useInventoryFullWarningStore = create<InventoryFullWarningState>((set) => ({
  triggeredAt: null,
  trigger: () => set({ triggeredAt: Date.now() }),
  clear: () => set({ triggeredAt: null }),
}))
