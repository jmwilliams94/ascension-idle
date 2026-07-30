import type { ItemTooltipData } from './itemTooltip'
import type { ItemTemplate } from './useItemTemplatesStore'

// Mirrors the cost formulas in
// supabase/migrations/20260727060000_scale_upgrade_costs.sql — preview only, for
// showing the player a cost before they commit. The actual cost/roll is always
// enforced server-side in the Postgres function; if these drift out of sync the
// worst case is a wrong preview number, not a wrong charge. Keep them in sync.

export function previewQualityUpgradeCost(qualityTier: string): number {
  switch (qualityTier) {
    case 'normal':
      return 1
    case 'refined':
      return 2
    case 'unique':
      return 3
    case 'elite':
      return 4
    default:
      return 1
  }
}

export function previewLevelUpgradeCost(level: number): number {
  return 1 + Math.floor(level / 5)
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
