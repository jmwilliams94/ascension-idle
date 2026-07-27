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

const QUALITY_LABELS: Record<string, string> = {
  normal: 'Normal',
  refined: 'Refined',
  unique: 'Unique',
  elite: 'Elite',
  super: 'Super',
}

// PLACEHOLDER color mapping — no official quality-tier color chart was found in
// research (see CLAUDE.md's Gear system section), these are just a reasonable
// common-to-rare gradient (gray -> blue -> purple -> orange -> red).
export const QUALITY_COLORS: Record<string, string> = {
  normal: '#9ca3af',
  refined: '#3b82f6',
  unique: '#a855f7',
  elite: '#f97316',
  super: '#ef4444',
}

export function getQualityColor(qualityTier: string): string {
  return QUALITY_COLORS[qualityTier] ?? QUALITY_COLORS.normal
}

export function formatQualityAndLevel(qualityTier: string, level: number): string {
  return `${QUALITY_LABELS[qualityTier] ?? qualityTier} · Lv ${level}`
}

// Display-layer only — the stored item_templates.name is never renamed. Normal
// quality shows the plain name; anything above gets the tier prefixed.
export function formatItemDisplayName(templateName: string, qualityTier: string): string {
  if (qualityTier === 'normal') {
    return templateName
  }

  const label = QUALITY_LABELS[qualityTier] ?? qualityTier
  return `${label} ${templateName}`
}
