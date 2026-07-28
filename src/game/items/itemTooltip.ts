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
  // Secondary info lines (quality/level, composition tier, ammo count, etc.).
  lines?: string[]
  // Stat bonus lines, shown in a visually distinct block below `lines`.
  stats?: string[]
}
