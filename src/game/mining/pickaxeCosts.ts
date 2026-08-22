import type { GemTypeId } from '../items/gemCatalog'

// Client-side preview mirror of pickaxe_tier_upgrade's cost table (see
// supabase/migrations/20260930060000_pickaxe_quality_tier_progression.sql) —
// the RPC is the only thing that actually spends anything; if these drift
// out of sync the worst case is a wrong preview number, same disclaimer as
// forgeCosts.ts's own preview functions.
//
// Tier Up bumps item_instances.quality_tier directly (2026-09-30, requested
// by the user — supersedes the earlier "5 separate item_templates rows,
// walk the chain" design) — same Normal→Tempered→Infused→Radiant→Ascended
// order every other quality-tiered item uses, just reached via this bespoke
// gold+gem cost instead of the standard Fallen-Star Quality Upgrade (which
// is explicitly blocked for Pickaxe, see unlock guard in
// 20260930070000_block_pickaxe_quality_upgrade.sql).
const QUALITY_TIER_ORDER = ['normal', 'tempered', 'infused', 'radiant', 'ascended'] as const
type PickaxeQualityTier = (typeof QUALITY_TIER_ORDER)[number]

// All 4 coded gem types, all required at Normal/Tempered tier depending on
// the target — Ascended only requires the character's own rolled type.
const ALL_CODED_GEMS: GemTypeId[] = ['drake', 'ember', 'bastion', 'iris']

export interface PickaxeTierUpgradeCost {
  goldCost: number
  gemTier: 'normal' | 'tempered' | 'ascended'
  gemAmountEach: number
  gemIds: GemTypeId[]
}

// Returns null when already at max tier (Ascended) — nothing left to preview.
export function previewPickaxeTierUpgradeCost(
  currentQualityTier: string,
  ascendedGemType: GemTypeId | null,
): PickaxeTierUpgradeCost | null {
  const index = QUALITY_TIER_ORDER.indexOf(currentQualityTier as PickaxeQualityTier)
  const nextTier = index >= 0 ? QUALITY_TIER_ORDER[index + 1] : undefined
  if (!nextTier) return null

  switch (nextTier) {
    case 'tempered':
      return { goldCost: 100000, gemTier: 'normal', gemAmountEach: 5, gemIds: ALL_CODED_GEMS }
    case 'infused':
      return { goldCost: 250000, gemTier: 'tempered', gemAmountEach: 1, gemIds: ALL_CODED_GEMS }
    case 'radiant':
      return { goldCost: 500000, gemTier: 'tempered', gemAmountEach: 5, gemIds: ALL_CODED_GEMS }
    case 'ascended':
      // ascendedGemType is only known once the character has actually reached
      // Radiant and the server has rolled it — null here just means "not
      // rolled yet," shown as "revealed on your first Ascended attempt."
      return { goldCost: 0, gemTier: 'ascended', gemAmountEach: 1, gemIds: ascendedGemType ? [ascendedGemType] : [] }
    default:
      return null
  }
}
