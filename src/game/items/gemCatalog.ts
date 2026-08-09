// Dependency-free gem catalog/data — split out of gemTypes.ts (2026-08-10) so
// equipmentBonus.ts can read gem info for a socketed item's tooltip without a
// circular import (gemTypes.ts itself imports QUALITY_COLORS from
// equipmentBonus.ts for getGemTierColor/buildGemTooltip — the same
// "dependency-free shared module" pattern itemTooltip.ts already established
// for ItemTooltipData, see that file's own header comment). gemTypes.ts
// re-exports everything here unchanged, so no existing import site needs to
// change — only equipmentBonus.ts imports this file directly.

// Confirmed 2026-08-02: gems reuse gear's own quality-tier ladder/colors/
// ember-density rather than inventing a separate one, skipping Infused/Radiant.
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

export type GemTypeId = 'drake' | 'ember' | 'bastion' | 'iris'

export interface GemTypeDef {
  id: GemTypeId
  displayName: string
  effectLabel: string
  // Shorter label used only for the socketed-gem line inside a gear
  // tooltip's Sockets block (see describeSocketedGem below) — the gem's own
  // standalone tile tooltip (buildGemTooltip, gemTypes.ts) always uses the
  // full effectLabel unchanged. Falls back to effectLabel when omitted.
  shortEffectLabel?: string
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
    shortEffectLabel: 'EXP',
    percentByTier: { normal: 5, tempered: 10, ascended: 15 },
  },
}

export const GEM_TYPE_ORDER: GemTypeId[] = ['drake', 'ember', 'bastion', 'iris']

// Enchantress (2026-08-13) — consuming any gem, of any type, at a given tier
// rolls a flat HP bonus for a gear item somewhere in that tier's range (only
// the tier matters, not which of the 4 gem types was spent). Real reference
// ranges supplied by the user. Mirrors enchant_item_hp's own SQL case
// statement (20260813000000_enchantress_hp_enchant.sql) — keep in sync.
export const ENCHANT_HP_RANGE_BY_TIER: Record<GemTier, { min: number; max: number }> = {
  normal: { min: 1, max: 59 },
  tempered: { min: 100, max: 159 },
  ascended: { min: 200, max: 255 },
}

// A nice muted gold, deliberately distinct from the app's restrained amber
// accent and from the purple used for Composition's own "Bonus:" tooltip
// lines — per the user's "nice yellow (not fluoro)" request for the
// Enchanted HP tooltip line.
export const ENCHANT_HP_COLOR = '#E8C468'

// A soft, muted green — paired with ENCHANT_HP_COLOR's muted gold as the gear
// tooltip's two "bonus" accent colors. Used only for a filled socket's own
// gem description line inside a gear tooltip's Sockets block (see
// describeSocketedGem below) — the gem's own standalone tile tooltip
// (buildGemTooltip, gemTypes.ts) is unaffected.
export const SOCKETED_GEM_COLOR = '#7BC488'

// Enchantress's "Bless" tab (2026-08-13) — consuming one Ascended Bastion
// Gem advances a gear item's Blessed Damage Reduction along this fixed,
// deterministic ladder (no RNG, unlike the HP roll above). Mirrors
// bless_item's own SQL case statement (20260813070000_enchantress_bless.sql)
// — keep in sync. Applied as real incoming-damage mitigation in
// useCombatStore.runTick (see combatResolver.ts's applyDamageReduction) —
// client-only, same boundary as the rest of incoming player damage/HP, which
// has never been simulated server-side.
export const BLESS_PCT_STEPS: number[] = [1, 3, 5, 7]
export const BLESS_MAX_PCT = BLESS_PCT_STEPS[BLESS_PCT_STEPS.length - 1]

// A soft orange — distinct from ENCHANT_HP_COLOR's gold, the purple used for
// Composition's "Bonus:" lines, and SOCKETED_GEM_COLOR's green.
export const BLESS_COLOR = '#F0955C'

// Storage key into characters.gems (flat, mirrors composition_stones' own
// flat "1".."9" keys) — must stay in sync with the shape written by any RPC
// that grants/spends gems (draw_lucky_ticket, socket_gem, transfer_gem).
export function gemStorageKey(gemId: GemTypeId, tier: GemTier): string {
  return `${gemId}_${tier}`
}

const GEM_KEY_PATTERN = /^(drake|ember|bastion|iris)_(normal|tempered|ascended)$/

// Reverse of gemStorageKey — used to interpret a filled socket's raw stored
// value (item_instances.sockets[i], see socket_gem's SQL) back into a real
// gem+tier, and to validate/parse a gem drag id's payload. Returns null for
// anything that isn't exactly one of the 12 valid combinations (including
// null/empty sockets, which callers should already be handling separately).
export function parseGemStorageKey(key: string): { gemId: GemTypeId; tier: GemTier } | null {
  const match = GEM_KEY_PATTERN.exec(key)
  if (!match) {
    return null
  }
  return { gemId: match[1] as GemTypeId, tier: match[2] as GemTier }
}

export type GemCounts = Partial<Record<string, number>>

export function gemCount(counts: GemCounts, gemId: GemTypeId, tier: GemTier): number {
  return counts[gemStorageKey(gemId, tier)] ?? 0
}

// Gems are real, physical, non-stacking Inventory tiles (2026-08-09) — same
// synthetic-id convention as Comets/Stones (no per-unit DB row, just a
// running count per gemStorageKey), so each rendered tile gets an id
// combining the gem+tier with a render-time index purely for a stable React
// key. Mirrors stoneDragId/parseStoneDragId in forgeCosts.ts.
const GEM_DRAG_ID_PREFIX = 'gem:'

export function gemDragId(gemId: GemTypeId, tier: GemTier, index: number): string {
  return `${GEM_DRAG_ID_PREFIX}${gemId}:${tier}:${index}`
}

// Used by the Forge's Sockets tab to tell a dropped gem tile apart from a
// dropped gear item — same purpose as parseStoneDragId in forgeCosts.ts.
export function parseGemDragId(id: string): { gemId: GemTypeId; tier: GemTier } | null {
  if (!id.startsWith(GEM_DRAG_ID_PREFIX)) {
    return null
  }
  const [gemPart, tierPart] = id.slice(GEM_DRAG_ID_PREFIX.length).split(':')
  return parseGemStorageKey(`${gemPart}_${tierPart}`)
}

// User-supplied art only (existing item icons are polished/painterly
// renders, outside what the Aseprite pixel-art tool can match) — points at
// the expected filename for whenever the real PNG lands. Real distinct art
// per tier (revised 2026-08-08 — supersedes the original one-icon-per-gem-
// type/color-only design), still paired with getGemTierColor's border/glow.
export function getGemIconSrc(gemId: GemTypeId, tier: GemTier): string {
  return `${import.meta.env.BASE_URL}item-icons/gem-${gemId}-${tier}.png`
}

// One-line description of a socketed gem for use in plain string contexts
// (e.g. buildGearTooltip's socket lines) where a full ItemTooltipData card
// isn't appropriate. Deliberately generic — no tier prefix — since the gem's
// own tile elsewhere already shows its tier via color/icon; e.g. "Iris Gem —
// EXP +5%" (was "Tempered Drake Gem — Physical Attack +10%" before
// 2026-08-13). Only this socketed-gem line is generic this way — the gem's
// own standalone tile tooltip (buildGemTooltip, gemTypes.ts) still shows the
// full tier-prefixed name and effectLabel, unchanged.
export function describeSocketedGem(key: string): string | null {
  const parsed = parseGemStorageKey(key)
  if (!parsed) {
    return null
  }
  const gem = GEM_TYPES[parsed.gemId]
  const effectLabel = gem.shortEffectLabel ?? gem.effectLabel
  return `${gem.displayName} — ${effectLabel} +${gem.percentByTier[parsed.tier]}%`
}
