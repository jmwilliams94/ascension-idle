import type { EquipmentBonus } from '../stats/derivedStats'
import type { ItemTooltipData } from './itemTooltip'
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

const QUALITY_ORDER = ['normal', 'refined', 'unique', 'elite', 'super']

// Mirrors the quality_upgrade Postgres function's tier progression exactly (see
// supabase/migrations/20260727050000_add_quality_level_upgrade.sql's v_next_tier
// case statement) — used for the Forge preview, which needs to know the *next*
// tier before committing. Returns null when already at Super (the real max).
export function nextQualityTier(qualityTier: string): string | null {
  const index = QUALITY_ORDER.indexOf(qualityTier)
  if (index === -1 || index === QUALITY_ORDER.length - 1) {
    return null
  }
  return QUALITY_ORDER[index + 1]
}

export function formatQualityAndLevel(qualityTier: string, level: number): string {
  return `${QUALITY_LABELS[qualityTier] ?? qualityTier} · Lv ${level}`
}

// Display-layer only — the stored item_templates.name is never renamed. Normal
// quality shows the plain name; anything above gets the tier prefixed. Composition
// (see CLAUDE.md's Gear system section), when present, appends a "(+N)" suffix —
// confirmed format, e.g. "Refined Wooden Sword (+1)" — rather than showing on a
// separate line, so the name itself always reflects the item's full identity.
export function formatItemDisplayName(templateName: string, qualityTier: string, compositionLevel = 0): string {
  const base = qualityTier === 'normal' ? templateName : `${QUALITY_LABELS[qualityTier] ?? qualityTier} ${templateName}`
  return compositionLevel > 0 ? `${base} (+${compositionLevel})` : base
}

// Universal Diablo/PoE-style tooltip content for a gear item — the single source
// of truth for what a gear tooltip shows, reused everywhere a gear tile renders
// (InventoryPanel, ForgeUpgradeSlot, ForgeFuelSlots, EquipmentSlot's Main Hand)
// via InventorySlot's `tooltip` prop, so hovering any of them looks the same.
export function buildGearTooltip(item: ItemInstance, template: ItemTemplate | undefined): ItemTooltipData {
  return {
    title: template
      ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level)
      : 'Unknown item',
    titleColor: getQualityColor(item.quality_tier),
    lines: [formatQualityAndLevel(item.quality_tier, item.level)],
    stats: template ? formatBaseStats(template.base_stats).split(', ').filter(Boolean) : [],
  }
}
