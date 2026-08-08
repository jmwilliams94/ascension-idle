// Gem system data layer (see CLAUDE.md's Gem system section). Only 4 of the
// 8 designed gems are implemented so far — Drake/Ember/Bastion/Iris — the
// other 4 (Rage/Orchid/Kirin/Crescent) are rename-only in CLAUDE.md, not
// coded yet.
//
// Split 2026-08-10: the dependency-free parts (types, GEM_TYPES catalog, drag
// id helpers, icon lookup) moved to gemCatalog.ts so equipmentBonus.ts can
// import them without a circular import — this file re-exports all of that
// unchanged (no existing import site needs to change) and keeps only the two
// functions that actually need QUALITY_COLORS from equipmentBonus.ts.
import { QUALITY_COLORS } from './equipmentBonus'
import type { ItemTooltipData } from './itemTooltip'
import { GEM_TYPES, formatGemTierLabel, getGemIconSrc, type GemTier, type GemTypeId } from './gemCatalog'

export * from './gemCatalog'

// Reuses QUALITY_COLORS directly (not a copy) so the two ladders can never
// drift out of sync with each other — gem tier names are a strict subset of
// gear's quality tier names, so no mapping/renaming is needed.
export function getGemTierColor(tier: GemTier): string {
  return QUALITY_COLORS[tier]
}

// Universal Diablo/PoE-style tooltip content for a single gem tile — see
// buildStoneTooltip in forgeCosts.ts for the closest existing equivalent.
export function buildGemTooltip(gemId: GemTypeId, tier: GemTier): ItemTooltipData {
  const gem = GEM_TYPES[gemId]
  const color = getGemTierColor(tier)
  return {
    title: `${formatGemTierLabel(tier)} ${gem.displayName}`,
    titleColor: color,
    iconSrc: getGemIconSrc(gemId, tier),
    iconColor: color,
    lines: ['Socket material'],
    stats: [`${gem.effectLabel} +${gem.percentByTier[tier]}%`],
  }
}
