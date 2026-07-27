import type { EquipmentBonus } from '../stats/derivedStats'
import type { ItemInstance } from './useInventoryStore'
import type { ItemTemplate } from './useItemTemplatesStore'

// Pure function taking explicit snapshots rather than reading the stores itself, so
// it works both reactively (React components, fed by hooks) and imperatively (Phaser
// scene code, fed by .getState()) without duplicating the lookup logic.
export function computeEquipmentBonus(
  equippedItemId: string | null,
  items: ItemInstance[],
  templates: ItemTemplate[],
): EquipmentBonus {
  if (!equippedItemId) {
    return {}
  }

  const item = items.find((entry) => entry.id === equippedItemId)
  const template = item && templates.find((entry) => entry.id === item.template_id)

  if (!template) {
    return {}
  }

  const baseStats = template.base_stats
  return {
    physicalAttack: typeof baseStats.physical_attack === 'number' ? baseStats.physical_attack : undefined,
    magicAttack: typeof baseStats.magic_attack === 'number' ? baseStats.magic_attack : undefined,
  }
}

export function formatBaseStats(baseStats: Record<string, number>): string {
  return Object.entries(baseStats)
    .map(([key, value]) => `+${value} ${key.replace(/_/g, ' ')}`)
    .join(', ')
}
