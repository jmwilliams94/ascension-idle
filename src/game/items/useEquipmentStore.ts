import { create } from 'zustand'

// Multi-slot equipping (confirmed with the user, 2026-07-31) — supersedes the
// earlier single equippedItemId shortcut now that Ring/Necklace/Boots/Hat/Coat
// are real, functional slots alongside Main Hand. EquipSlot matches
// item_templates.slot_type exactly, so routing "which slot does this item go
// in" is just setEquippedItem(template.slot_type, item.id) — no slot-picker UI
// needed. 'quiver' (added 2026-07-31) is the Hunter-only off-hand item itself
// (see useArrowStore for the 3-slot ammo container it provides) — every other
// class's off-hand stays a locked placeholder in EquipmentPanel, since no
// shield item_family exists yet.
export type EquipSlot = 'weapon' | 'ring' | 'necklace' | 'boots' | 'hat' | 'coat' | 'quiver'

export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'ring', 'necklace', 'boots', 'hat', 'coat', 'quiver']

interface EquipmentState {
  equippedIds: Record<EquipSlot, string | null>
  hydrate: (equipped: Record<EquipSlot, string | null>) => void
  setEquippedItem: (slot: EquipSlot, itemId: string | null) => void
  // True if itemId occupies any of the 6 slots — used to hide an equipped item
  // from Inventory (see useInventoryStore.occupiedSlotCount/InventoryPanel)
  // regardless of which slot it's actually in.
  isEquipped: (itemId: string) => boolean
}

export const useEquipmentStore = create<EquipmentState>((set, get) => ({
  equippedIds: { weapon: null, ring: null, necklace: null, boots: null, hat: null, coat: null, quiver: null },
  hydrate: (equipped) => set({ equippedIds: equipped }),
  setEquippedItem: (slot, itemId) => set((state) => ({ equippedIds: { ...state.equippedIds, [slot]: itemId } })),
  isEquipped: (itemId) => Object.values(get().equippedIds).includes(itemId),
}))
