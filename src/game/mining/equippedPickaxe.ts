import { useEquipmentStore } from '../items/useEquipmentStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../items/useItemTemplatesStore'

// Pickaxe is now a normal Main Hand weapon (requested by the user) — it
// shares equipped_weapon_id with the character's real combat weapon, so
// "is a Pickaxe currently equipped" is derived live off the standard
// equipment/inventory/template stores rather than a separate
// equipped_pickaxe_id pointer. Used by both useMiningStore.ts (attack calc,
// and to auto-stop mining the instant this stops resolving) and
// MiningModePanel.tsx (display + Tier Up targeting).
export function getEquippedPickaxe(): { item: ItemInstance; template: ItemTemplate } | null {
  const weaponId = useEquipmentStore.getState().equippedIds.weapon
  if (!weaponId) return null
  const item = useInventoryStore.getState().items.find((entry) => entry.id === weaponId)
  if (!item) return null
  const template = useItemTemplatesStore.getState().templates.find((entry) => entry.id === item.template_id)
  if (!template || template.item_family !== 'pickaxe') return null
  return { item, template }
}
