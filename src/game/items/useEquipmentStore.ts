import { create } from 'zustand'

// Single-slot shortcut: only the weapon slot exists this step, so one nullable id is
// enough. Will need to become a multi-slot shape (map of slot_type -> item id) once
// other gear slots exist — see the equipped_item_id column note in the migration.
interface EquipmentState {
  equippedItemId: string | null
  hydrate: (equippedItemId: string | null) => void
  setEquippedItemId: (id: string | null) => void
}

export const useEquipmentStore = create<EquipmentState>((set) => ({
  equippedItemId: null,
  hydrate: (equippedItemId) => set({ equippedItemId }),
  setEquippedItemId: (id) => set({ equippedItemId: id }),
}))
