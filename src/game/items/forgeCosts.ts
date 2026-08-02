import type { ItemTooltipData } from './itemTooltip'
import type { ItemTemplate } from './useItemTemplatesStore'

// Mirrors the flat cost in supabase/migrations/20260731070000_forge_flat_currency_cost.sql
// (stage 3 of the Bank/Warehouse redesign — supersedes the earlier scaling
// formulas from 20260727060000_scale_upgrade_costs.sql) — preview only, for
// showing the player a cost before they commit. The actual cost/roll is always
// enforced server-side in the Postgres function; if these drift out of sync the
// worst case is a wrong preview number, not a wrong charge. Keep them in sync.

export function previewQualityUpgradeCost(): number {
  return 1
}

export function previewLevelUpgradeCost(): number {
  return 1
}

// Client-side mirror of level_upgrade's next-template lookup (see
// 20260730020000_level_upgrade_next_tier.sql) — the next template sharing this
// one's item_family with the lowest required_level above it, or null if this is
// already the top of its chain (or has no chain at all, e.g. item_family is
// null). Used only for the Forge's preview/disabled-state, never to decide the
// actual outcome — the RPC is still the source of truth.
export function findNextTemplateInChain(templates: ItemTemplate[], current: ItemTemplate): ItemTemplate | null {
  if (!current.item_family) {
    return null
  }

  return (
    templates
      .filter((template) => template.item_family === current.item_family && template.required_level > current.required_level)
      .sort((a, b) => a.required_level - b.required_level)[0] ?? null
  )
}

// Composition (see CLAUDE.md's Gear system section) — a points accumulator with
// guaranteed progress and no RNG, distinct from Quality/Level Upgrade above.
// Mirrors composition_feed's SQL exactly (supabase/migrations/20260728000000_add_composition.sql)
// — keep in sync.
export const COMPOSITION_STONE_TIERS = [1, 2, 3, 4] as const

// Confirmed formula: a stone of tier N is worth 10 * 3^(N-1) points (10, 30, 90,
// 270...); a fuel item's own composition_level values the same way, except Normal
// (level 0, uncomposed) contributes nothing.
export function compositionPointValue(level: number): number {
  if (level <= 0) {
    return 0
  }
  return 10 * 3 ** (level - 1)
}

// Confirmed formula: advancing from composition_level L to L+1 costs
// 20 * 3^max(L-1, 0) points (Normal->+1 and +1->+2 both cost 20, +2->+3 costs 60,
// +3->+4 costs 180, ...).
export function compositionPointsRequired(currentLevel: number): number {
  return 20 * 3 ** Math.max(currentLevel - 1, 0)
}

export function formatCompositionTier(level: number): string {
  return level <= 0 ? 'Normal' : `+${level}`
}

export interface CompositionSimulation {
  level: number
  points: number
  required: number
}

// Client-side mirror of composition_feed's tier-up loop, used for the Forge's live
// "after feed" preview — a single large feed can cross multiple tiers at once,
// carrying leftover points forward correctly each time, same as the real function.
export function simulateCompositionFeed(currentLevel: number, currentPoints: number, addedPoints: number): CompositionSimulation {
  let level = currentLevel
  let points = currentPoints + addedPoints
  let required = compositionPointsRequired(level)

  while (points >= required) {
    points -= required
    level += 1
    required = compositionPointsRequired(level)
  }

  return { level, points, required }
}

// Stones are drag-and-drop inventory items now (see InventoryPanel/ForgeFuelZone),
// not a typed-in quantity — and confirmed to NOT stack: each stone is its own
// inventory tile/slot, not combined into one tile with a count badge. There's no
// per-stone UUID (the backend is still just a running total per tier on the
// character, characters.composition_stones), so each individual tile gets a
// synthetic id combining the tier with a render-time index (0..count-1) purely to
// give React a stable key and to let exactly *one* tile be reserved/dragged at a
// time — the index has no meaning beyond that, since same-tier stones are fully
// fungible. Dragging one tile always feeds exactly one stone of that tier; feeding
// more means dragging in more individual tiles.
const STONE_DRAG_ID_PREFIX = 'stone:'

export function stoneDragId(tier: number, index: number): string {
  return `${STONE_DRAG_ID_PREFIX}${tier}:${index}`
}

// Only the tier matters for feed/point-value purposes — the index is discarded.
export function parseStoneDragId(id: string): number | null {
  if (!id.startsWith(STONE_DRAG_ID_PREFIX)) {
    return null
  }

  const [tierPart] = id.slice(STONE_DRAG_ID_PREFIX.length).split(':')
  const tier = Number(tierPart)
  return (COMPOSITION_STONE_TIERS as readonly number[]).includes(tier) ? tier : null
}

// Universal Diablo/PoE-style tooltip content for a single stone — see
// buildGearTooltip in equipmentBonus.ts for the gear equivalent.
export function buildStoneTooltip(tier: number): ItemTooltipData {
  return {
    title: `+${tier} Stone`,
    lines: ['Composition material'],
    stats: [`${compositionPointValue(tier)} pts`],
  }
}

// Meteors/DragonBalls are individual, non-stacking Inventory items now (confirmed
// with the user, 2026-07-31 — see CLAUDE.md's Warehouse economy redesign note),
// same pattern as Composition Stones above: no per-unit id in the backend (just a
// running count, characters.meteor_count/dragonball_count), so each rendered tile
// gets a synthetic id combining the currency with a render-time index, purely for
// a stable React key — same-currency units are fully fungible, the index has no
// other meaning.
const METEOR_DRAG_ID_PREFIX = 'meteor:'
const DRAGONBALL_DRAG_ID_PREFIX = 'dragonball:'

export function meteorDragId(index: number): string {
  return `${METEOR_DRAG_ID_PREFIX}${index}`
}

export function dragonballDragId(index: number): string {
  return `${DRAGONBALL_DRAG_ID_PREFIX}${index}`
}

// Used by Forge's Material slot (ForgePanel.tsx) to tell a dragged Meteor/
// DragonBall tile apart from a stone/gear fuel tile — the prefix check is
// safe against the Scroll ids below (e.g. "dragonball-scroll:0") since those
// have "-scroll" right after the currency name, not a colon.
export function isMeteorDragId(id: string): boolean {
  return id.startsWith(METEOR_DRAG_ID_PREFIX)
}

export function isDragonballDragId(id: string): boolean {
  return id.startsWith(DRAGONBALL_DRAG_ID_PREFIX)
}

// Real art (2026-08-02), supersedes the 🌠/🔮 emoji everywhere a Meteor/
// DragonBall tile renders (InventoryPanel's grid + detail card,
// LootHoldingCard) — pass to InventorySlot's iconSrc prop, which takes
// priority over its emoji icon prop.
export const METEOR_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/meteor.png`
export const DRAGONBALL_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/dragonball.png`

// Own distinct border/glow colors (2026-08-02), same InventorySlot
// qualityColor mechanism gear uses for its tier tint — materials previously
// rendered with the same plain slate border as an empty/generic tile, giving
// them no visual identity of their own. DragonBall reuses the old (pre-
// recalibration) Ascended orange at the user's request.
export const DRAGONBALL_COLOR = '#F0B87A'

// Revised same day, per the user: Meteor's own green was reassigned to
// Consumables instead (a broader category the user wants visually unified as
// green), and "all other materials" — Meteor, Composition Stones, and
// (once built) Gems — now share one color instead of each getting its own:
// the old (pre-recalibration) Infused Silver, the user's specific pick from
// that retired palette. Distinct from DRAGONBALL_COLOR (still its own
// orange, not folded into this) and from every QUALITY_COLORS value.
export const MATERIAL_COLOR = '#C8D0DC'

// Potions (HP/Mana) — see potionTypes.ts/InventoryPanel.tsx's potion tiles.
export const CONSUMABLE_COLOR = '#4ADE80'

export function buildMeteorTooltip(): ItemTooltipData {
  return {
    title: 'Meteor',
    lines: ['Forge material'],
    stats: ['Used for Level Upgrade'],
  }
}

export function buildDragonballTooltip(): ItemTooltipData {
  return {
    title: 'DragonBall',
    lines: ['Forge material'],
    stats: ['Used for Quality Upgrade'],
  }
}

// Meteor Scroll / DragonBall Scroll (stage 2 of the Warehouse economy
// redesign, 2026-07-31) — a compact-storage bundle of 10 loose units into 1
// non-stacking Inventory item. Same synthetic-id convention as the units
// themselves (no per-unit DB row, just a running count —
// characters.meteor_scroll_count/dragonball_scroll_count).
const METEOR_SCROLL_DRAG_ID_PREFIX = 'meteor-scroll:'
const DRAGONBALL_SCROLL_DRAG_ID_PREFIX = 'dragonball-scroll:'

export function meteorScrollDragId(index: number): string {
  return `${METEOR_SCROLL_DRAG_ID_PREFIX}${index}`
}

export function dragonballScrollDragId(index: number): string {
  return `${DRAGONBALL_SCROLL_DRAG_ID_PREFIX}${index}`
}

// Same purpose as isMeteorDragId/isDragonballDragId above — used by the
// Marketplace's "List an Item" drop zone to tell a dragged Scroll tile apart
// from a loose unit or gear item.
export function isMeteorScrollDragId(id: string): boolean {
  return id.startsWith(METEOR_SCROLL_DRAG_ID_PREFIX)
}

export function isDragonballScrollDragId(id: string): boolean {
  return id.startsWith(DRAGONBALL_SCROLL_DRAG_ID_PREFIX)
}

export function buildMeteorScrollTooltip(): ItemTooltipData {
  return {
    title: 'Meteor Scroll',
    lines: ['Compact storage'],
    stats: ['Holds 10 Meteors — Open to unbundle'],
  }
}

export function buildDragonballScrollTooltip(): ItemTooltipData {
  return {
    title: 'DragonBall Scroll',
    lines: ['Compact storage'],
    stats: ['Holds 10 DragonBalls — Open to unbundle'],
  }
}

// Gear's "Deposit as Composition" path (stage 4 of the Warehouse economy
// redesign, 2026-07-31) — six separate, non-fungible per-slot-type point
// pools (characters.gear_composition_points jsonb), distinct from the shared
// warehouse_points balance stones/"Deposit as Item" tokens liquidate into. A
// Ring's points can only ever buy back a Ring, never a Coat. Same point-value/
// cost formulas as Composition/Stones (compositionPointValue/
// compositionPointsRequired above) — mirrors deposit_item_as_composition/
// withdraw_gear_composition's SQL; keep in sync.
export const GEAR_SLOT_TYPES = ['weapon', 'ring', 'necklace', 'boots', 'hat', 'coat'] as const
export type GearSlotType = (typeof GEAR_SLOT_TYPES)[number]

export type GearCompositionPoints = Record<GearSlotType, number>

export const DEFAULT_GEAR_COMPOSITION_POINTS: GearCompositionPoints = {
  weapon: 0,
  ring: 0,
  necklace: 0,
  boots: 0,
  hat: 0,
  coat: 0,
}

const GEAR_SLOT_LABELS: Record<GearSlotType, string> = {
  weapon: 'Weapon',
  ring: 'Ring',
  necklace: 'Necklace',
  boots: 'Boots',
  hat: 'Hat',
  coat: 'Coat',
}

export function formatGearSlotLabel(slotType: GearSlotType): string {
  return GEAR_SLOT_LABELS[slotType]
}
