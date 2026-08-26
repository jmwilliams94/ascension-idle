import { useCharacterRecordStore } from '../../lib/useCharacterRecordStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../items/useItemTemplatesStore'

// Pickaxe has its own dedicated equip pointer again (2026-10-24, requested
// by the user) — characters.equipped_pickaxe_id, independent of
// equipped_weapon_id/useEquipmentStore, so a character can wear a real
// weapon and a Pickaxe at the same time. "Is a Pickaxe currently equipped"
// reads that pointer off useCharacterRecordStore rather than the equipment
// store. Used by both useMiningStore.ts (attack calc, and to auto-stop
// mining the instant this stops resolving) and MiningModePanel.tsx (display
// + Tier Up targeting).
export function getEquippedPickaxe(): { item: ItemInstance; template: ItemTemplate } | null {
  const pickaxeId = useCharacterRecordStore.getState().equippedPickaxeId
  if (!pickaxeId) return null
  const item = useInventoryStore.getState().items.find((entry) => entry.id === pickaxeId)
  if (!item) return null
  const template = useItemTemplatesStore.getState().templates.find((entry) => entry.id === item.template_id)
  if (!template || template.item_family !== 'pickaxe') return null
  return { item, template }
}
