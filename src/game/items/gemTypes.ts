// Gem system data layer (see CLAUDE.md's Gem system section). Only 4 of the
// 8 designed gems are implemented so far — Drake/Ember/Bastion/Iris — the
// other 4 (Rage/Orchid/Kirin/Crescent) are rename-only in CLAUDE.md, not
// coded yet.
//
// Deliberately inert: nothing in the app calls anything here yet (no drop
// source, no Inventory-tile rendering, no Forge socketing, no client
// save/hydrate plumbing touching characters.gems). This file exists purely
// as the data/tooltip layer to build against once "how they're obtainable"
// is designed.
import { QUALITY_COLORS } from './equipmentBonus'
import type { ItemTooltipData } from './itemTooltip'

// Confirmed 2026-08-02: gems reuse gear's own quality-tier ladder/colors/
// ember-density rather than a separate one, skipping Infused/Radiant. See
// EMBER_DENSITY_BY_COLOR in tierEffectsData.ts, which already reserves
// Tempered=5/Ascended=100 for whenever gems land — don't invent new numbers.
export type GemTier = 'normal' | 'tempered' | 'ascended'

export const GEM_TIERS: GemTier[] = ['normal', 'tempered', 'ascended']

const GEM_TIER_LABELS: Record<GemTier, string> = {
  normal: 'Normal',
  tempered: 'Tempered',
  ascended: 'Ascended',
}

export function formatGemTierLabel(tier: GemTier): string {
  return GEM_TIER_LABELS[tier]
}

// Reuses QUALITY_COLORS directly (not a copy) so the two ladders can never
// drift out of sync with each other — gem tier names are a strict subset of
// gear's quality tier names, so no mapping/renaming is needed.
export function getGemTierColor(tier: GemTier): string {
  return QUALITY_COLORS[tier]
}

export type GemTypeId = 'drake' | 'ember' | 'bastion' | 'iris'

export interface GemTypeDef {
  id: GemTypeId
  displayName: string
  effectLabel: string
  percentByTier: Record<GemTier, number>
}

export const GEM_TYPES: Record<GemTypeId, GemTypeDef> = {
  drake: {
    id: 'drake',
    displayName: 'Drake Gem',
    effectLabel: 'Physical Attack',
    percentByTier: { normal: 5, tempered: 10, ascended: 15 },
  },
  ember: {
    id: 'ember',
    displayName: 'Ember Gem',
    effectLabel: 'Magic Attack',
    percentByTier: { normal: 5, tempered: 10, ascended: 15 },
  },
  bastion: {
    id: 'bastion',
    displayName: 'Bastion Gem',
    effectLabel: 'Damage Reduction',
    percentByTier: { normal: 5, tempered: 10, ascended: 15 },
  },
  iris: {
    id: 'iris',
    displayName: 'Iris Gem',
    effectLabel: 'Character EXP',
    percentByTier: { normal: 5, tempered: 10, ascended: 15 },
  },
}

export const GEM_TYPE_ORDER: GemTypeId[] = ['drake', 'ember', 'bastion', 'iris']

// Storage key into characters.gems (flat, mirrors composition_stones' own
// flat "1".."9" keys) — must stay in sync with the shape written by any
// future RPC that grants/spends gems.
export function gemStorageKey(gemId: GemTypeId, tier: GemTier): string {
  return `${gemId}_${tier}`
}

export type GemCounts = Partial<Record<string, number>>

export function gemCount(counts: GemCounts, gemId: GemTypeId, tier: GemTier): number {
  return counts[gemStorageKey(gemId, tier)] ?? 0
}

// User-supplied art only (existing item icons are polished/painterly
// renders, outside what the Aseprite pixel-art tool can match) — points at
// the expected filename for whenever the real PNG lands. One icon per gem
// type; tier is conveyed via getGemTierColor's border/glow, not separate art.
export function getGemIconSrc(gemId: GemTypeId): string {
  return `${import.meta.env.BASE_URL}item-icons/gem-${gemId}.png`
}

// Universal Diablo/PoE-style tooltip content for a single gem tile — see
// buildStoneTooltip in forgeCosts.ts for the closest existing equivalent.
export function buildGemTooltip(gemId: GemTypeId, tier: GemTier): ItemTooltipData {
  const gem = GEM_TYPES[gemId]
  const color = getGemTierColor(tier)
  return {
    title: `${formatGemTierLabel(tier)} ${gem.displayName}`,
    titleColor: color,
    iconSrc: getGemIconSrc(gemId),
    iconColor: color,
    lines: ['Socket material'],
    stats: [`${gem.effectLabel} +${gem.percentByTier[tier]}%`],
  }
}
