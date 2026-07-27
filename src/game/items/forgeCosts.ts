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
