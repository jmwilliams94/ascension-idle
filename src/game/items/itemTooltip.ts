// Shared contract for the universal Diablo/PoE-style hover tooltip (ItemTooltip.tsx)
// — a neutral, dependency-free module so both game-logic builders
// (equipmentBonus.ts's buildGearTooltip, forgeCosts.ts's buildStoneTooltip) and the
// presentational component can import the same shape without a circular import
// between the two builder modules.
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
  lines?: string[]
  // Stat bonus lines, shown in a visually distinct block below `lines`.
  stats?: string[]
  // Composition ("+N") stat bonus lines (see equipmentBonus.ts's
  // computeCompositionBonusStats) — rendered directly below `stats` in
  // purple to read as a distinct bonus source, not part of the item's base
  // stats block.
  bonusStats?: string[]
}
