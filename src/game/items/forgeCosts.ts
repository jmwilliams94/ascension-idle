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
