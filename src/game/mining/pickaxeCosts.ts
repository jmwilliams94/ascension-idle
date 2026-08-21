import type { GemTypeId } from '../items/gemCatalog'

// Client-side preview mirror of pickaxe_tier_upgrade's cost table (see
// supabase/migrations/20260926000000_add_mining_pickaxe.sql) — the RPC is the
// only thing that actually spends anything; if these drift out of sync the
// worst case is a wrong preview number, same disclaimer as forgeCosts.ts's
// own preview functions.

export const PICKAXE_TIER_ORDER = ['Pickaxe', 'Tempered Pickaxe', 'Infused Pickaxe', 'Radiant Pickaxe', 'Ascended Pickaxe'] as const
export type PickaxeTierName = (typeof PICKAXE_TIER_ORDER)[number]

export const PICKAXE_ATTACK_BY_TIER: Record<PickaxeTierName, number> = {
  Pickaxe: 50,
  'Tempered Pickaxe': 100,
  'Infused Pickaxe': 150,
  'Radiant Pickaxe': 200,
  'Ascended Pickaxe': 250,
}

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
  currentTierName: string,
  ascendedGemType: GemTypeId | null,
): PickaxeTierUpgradeCost | null {
  const index = PICKAXE_TIER_ORDER.indexOf(currentTierName as PickaxeTierName)
  const nextName = index >= 0 ? PICKAXE_TIER_ORDER[index + 1] : undefined
  if (!nextName) return null

  switch (nextName) {
    case 'Tempered Pickaxe':
      return { goldCost: 100000, gemTier: 'normal', gemAmountEach: 5, gemIds: ALL_CODED_GEMS }
    case 'Infused Pickaxe':
      return { goldCost: 250000, gemTier: 'tempered', gemAmountEach: 1, gemIds: ALL_CODED_GEMS }
    case 'Radiant Pickaxe':
      return { goldCost: 500000, gemTier: 'tempered', gemAmountEach: 5, gemIds: ALL_CODED_GEMS }
    case 'Ascended Pickaxe':
      // ascendedGemType is only known once the character has actually reached
      // Radiant and the server has rolled it — null here just means "not
      // rolled yet," shown as "revealed on your first Ascended attempt."
      return { goldCost: 0, gemTier: 'ascended', gemAmountEach: 1, gemIds: ascendedGemType ? [ascendedGemType] : [] }
    default:
      return null
  }
}
