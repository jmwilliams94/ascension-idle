// Shared contract for the universal Diablo/PoE-style hover tooltip (ItemTooltip.tsx)
// — a neutral, dependency-free module so both game-logic builders
// (equipmentBonus.ts's buildGearTooltip, forgeCosts.ts's buildStoneTooltip) and the
// presentational component can import the same shape without a circular import
// between the two builder modules.

// A plain string renders in that block's own default color (slate for
// `lines`, sky blue for `stats`); an object overrides the color for just that
// one line — used e.g. for Lvl/Class/"Sockets"/physical defense/dodge (white)
// and a filled socket's own gem description (soft green), while everything
// else keeps the block's default.
export type TooltipLine = string | { text: string; color: string }

// `stats`' own default color (sky blue) — exported so a builder placing a
// stat line inside `lines` instead (see buildGearTooltip's base-stat lines,
// moved 2026-08-13 to sit between Class and Sockets) can still explicitly
// color it as a "stat," since `lines`' own default (DEFAULT_LINE_COLOR,
// ItemTooltip.tsx) is a plainer slate.
export const DEFAULT_STAT_COLOR = '#7dd3fc'

export interface ItemTooltipData {
  title: string
  // Quality color for gear; omitted (falls back to a neutral slate) for
  // non-quality-tiered things like arrows/stones.
  titleColor?: string
  // Icon shown in a small bordered box beside the title (2026-08-03,
  // confirmed with the user from a reference screenshot) — same
  // iconSrc-over-icon priority InventorySlot already established (real art
  // wins when both are supplied). Omitted entirely (no icon box at all) when
  // neither is set, rather than showing an empty box.
  icon?: string
  iconSrc?: string
  // Border/tint color for that icon box — deliberately separate from
  // titleColor (even though gear sets both to the same quality color) so a
  // builder can give the icon box a color without also recoloring the title
  // text, e.g. stones/currency tooltips whose title has always rendered in
  // the default neutral slate.
  iconColor?: string
  // Secondary info lines (quality/level, composition tier, ammo count, etc.).
  // For gear specifically (buildGearTooltip), this also carries the item's
  // base combat stats (white physical defense/dodge, then blue everything
  // else) positioned after Class and before Sockets — see that function's
  // own comment for why these live here instead of in `stats` below.
  lines?: TooltipLine[]
  // Stat bonus lines, shown in a visually distinct bordered block below
  // `lines` — used by non-gear tooltips (stones, gems, currency) for their
  // own stat lines. Gear tooltips leave this empty (their stats moved into
  // `lines`, see above); the bordered block still renders for gear whenever
  // bonusStats/enchantLine/blessLine are present.
  stats?: TooltipLine[]
  // Composition ("+N") stat bonus lines (see equipmentBonus.ts's
  // computeCompositionBonusStats) — rendered directly below `stats` in
  // purple to read as a distinct bonus source, not part of the item's base
  // stats block.
  bonusStats?: string[]
  // Enchantress HP bonus (see gemCatalog.ts's ENCHANT_HP_RANGE_BY_TIER) —
  // "Enchanted HP: XX", rendered in its own muted gold below bonusStats.
  // Omitted entirely for an item with no enchant.
  enchantLine?: string
  // Enchantress "Bless" bonus (see gemCatalog.ts's BLESS_PCT_STEPS) —
  // "Damage: -N%", rendered directly below enchantLine in its own soft
  // orange (BLESS_COLOR). Omitted entirely for an item with no blessing.
  blessLine?: string
  // Composition progression (see equipmentBonus.ts's buildGearTooltip) —
  // "Progression: X/N" toward the item's next Composition tier. Kept as its
  // own field (2026-08-14), rather than folded into `lines`/`bonusStats`, so
  // it can render as the very last thing in the card regardless of whether
  // the bonusStats/enchantLine/blessLine block is present. Omitted entirely
  // below +1 or once maxed (see that function's own comment).
  progressionLine?: string
}
