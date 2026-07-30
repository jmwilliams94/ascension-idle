import { CLASS_DEFINITIONS, type ClassId } from '../stats/classes'
import type { EquipmentBonus } from '../stats/derivedStats'
import type { ItemTooltipData } from './itemTooltip'
import type { ItemInstance } from './useInventoryStore'
import type { ItemTemplate } from './useItemTemplatesStore'

// How much stronger each quality tier is than the template's stored (Normal-tier)
// base_stats — an approximate, rounded pattern (not any single sourced item's
// exact ratios), applied uniformly to every item rather than baked into a
// separate row per tier. This is what makes a quality upgrade actually do
// something mechanically — previously quality_tier was stored but never read
// here at all (a documented gap; see CLAUDE.md's Forge/Gear system notes).
export const QUALITY_STAT_MULTIPLIERS: Record<string, number> = {
  normal: 1,
  refined: 1.1,
  unique: 1.2,
  elite: 1.35,
  super: 1.5,
}

function scaledStat(baseStats: Record<string, number>, key: string, qualityTier: string): number | undefined {
  const base = baseStats[key]
  if (typeof base !== 'number') {
    return undefined
  }
  const multiplier = QUALITY_STAT_MULTIPLIERS[qualityTier] ?? 1
  return Math.round(base * multiplier)
}

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

  if (!item || !template) {
    return {}
  }

  const baseStats = template.base_stats
  return {
    physicalAttack: scaledStat(baseStats, 'physical_attack', item.quality_tier),
    magicAttack: scaledStat(baseStats, 'magic_attack', item.quality_tier),
  }
}

// Client-side mirror of sell_item's SQL formula (see
// 20260730060000_add_sell_item.sql) — must stay in sync, same pattern as
// every other Forge/Shop cost preview in this codebase. PLACEHOLDER: half of
// the template's buy price, scaled by quality — unresolved per CLAUDE.md like
// the rest of this economy, and deliberately ignores composition level for
// now (a minimal first pass, not a full item-valuation redesign).
export function previewSellPrice(price: number, qualityTier: string): number {
  return Math.round(price * 0.5 * (QUALITY_STAT_MULTIPLIERS[qualityTier] ?? 1))
}

export function formatBaseStats(baseStats: Record<string, number>): string {
  return Object.entries(baseStats)
    .map(([key, value]) => `+${value} ${key.replace(/_/g, ' ')}`)
    .join(', ')
}

// Display names only — the underlying stored quality_tier values ('normal',
// 'refined', 'unique', 'elite', 'super') are unchanged, so this rename needed
// no schema/migration/SQL changes at all, just remapping these two lookup
// tables. Confirmed tier names/colors (replaces the earlier placeholder
// gray->blue->purple->orange->red gradient with a real, designed palette).
const QUALITY_LABELS: Record<string, string> = {
  normal: 'Normal',
  refined: 'Tempered',
  unique: 'Infused',
  elite: 'Radiant',
  super: 'Ascended',
}

export const QUALITY_COLORS: Record<string, string> = {
  normal: '#FFFFFF',
  refined: '#E8C99B',
  unique: '#C8D0DC',
  elite: '#A8D8F0',
  super: '#F0B87A',
}

export function getQualityColor(qualityTier: string): string {
  return QUALITY_COLORS[qualityTier] ?? QUALITY_COLORS.normal
}

// Matches the locked placeholder slot icons already used in EquipmentPanel's
// paper doll, so a real item and its slot's empty-state icon read as the same
// thing. Previously every gear tile everywhere hardcoded the sword emoji
// regardless of slot_type — a coat or hat displayed with a sword icon, a
// separate (cosmetic) bug from the equip-into-weapon-slot bug fixed in 1.28.1.
const SLOT_ICONS: Record<string, string> = {
  weapon: '🗡️',
  hat: '🪖',
  coat: '🥋',
  necklace: '📿',
  ring: '💍',
  boots: '👢',
}

export function getItemIcon(slotType: string | undefined): string {
  return (slotType && SLOT_ICONS[slotType]) || '🗡️'
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
  // "Class: ___" is display-only for now — just the plain class name (e.g.
  // "Hunter"), not a promotion-tier-specific name (no promotion-tier naming
  // exists yet). Nothing currently blocks equipping across classes; this is
  // flavor/info ahead of that enforcement existing.
  const classLine =
    template?.required_class && template.required_class in CLASS_DEFINITIONS
      ? `Class: ${CLASS_DEFINITIONS[template.required_class as ClassId].displayName}`
      : null

  return {
    title: template
      ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level)
      : 'Unknown item',
    titleColor: getQualityColor(item.quality_tier),
    lines: [formatQualityAndLevel(item.quality_tier, item.level), ...(classLine ? [classLine] : [])],
    stats: template ? formatBaseStats(template.base_stats).split(', ').filter(Boolean) : [],
  }
}
