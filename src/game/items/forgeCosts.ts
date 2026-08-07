import type { ItemTooltipData } from './itemTooltip'
import type { ItemTemplate } from './useItemTemplatesStore'

// Mirrors the flat cost in supabase/migrations/20260731070000_forge_flat_currency_cost.sql
// (stage 3 of the Bank/Warehouse redesign — supersedes the earlier scaling
// formulas from 20260727060000_scale_upgrade_costs.sql) — preview only, for
// showing the player a cost before they commit. The actual cost/roll is always
// enforced server-side in the Postgres function; if these drift out of sync the
// worst case is a wrong preview number, not a wrong charge. Keep them in sync.

export function previewQualityUpgradeCost(): number {
  return 1
}

export function previewLevelUpgradeCost(): number {
  return 1
}

// Dynamic success chance (2026-08-05, confirmed with the user — mirrors
// compute_upgrade_success_chance_pct in migration
// 20260805030000_dynamic_upgrade_chance_and_master_forge.sql, must stay in
// sync). Supersedes the old flat 70%/80% — the real roll (in
// quality_upgrade/level_upgrade) is always server-side and this mirror is
// never itself authoritative; it exists purely so Master Forge can preview a
// cost client-side without a network round trip (regular Forge still shows
// no odds at all, per the existing "no success rate is ever shown" design —
// this mirror is Master-Forge-only).
//
// Level Upgrade: 90% (item's own level is the lowest in its family chain) to
// 60% (highest), halved again for every quality tier above Normal. Quality
// Upgrade: 85% to 75% by the same level-position logic, x0.58 per quality
// tier above Normal (retuned same day from x0.65 — the user asked for
// Radiant->Ascended specifically to land "closer to the 15% mark," which
// x0.58 does almost exactly: ~14.6-16.6%). Both PLACEHOLDER curves, same
// disclosed-not-final status as every other economy number in this game —
// Level Upgrade's is grounded in a real reference point the user supplied
// ("upgrading super gear from level 100 to 110 used to cost about 20-40
// comets," i.e. ~2.5-5% near max level/quality); Quality Upgrade's has no
// such anchor beyond the Radiant target above.
const QUALITY_TIER_INDEX: Record<string, number> = { normal: 0, tempered: 1, infused: 2, radiant: 3, ascended: 4 }

export function computeUpgradeSuccessChancePct(
  templates: ItemTemplate[],
  itemFamily: string | null,
  requiredLevel: number,
  qualityTier: string,
  upgradeType: 'level' | 'quality',
): number {
  const familyTemplates = itemFamily ? templates.filter((template) => template.item_family === itemFamily) : []
  const levels = familyTemplates.map((template) => template.required_level)
  const minLevel = levels.length > 0 ? Math.min(...levels) : requiredLevel
  const maxLevel = levels.length > 0 ? Math.max(...levels) : requiredLevel

  const t = maxLevel > minLevel ? Math.min(1, Math.max(0, (requiredLevel - minLevel) / (maxLevel - minLevel))) : 0

  const qualityIndex = QUALITY_TIER_INDEX[qualityTier] ?? 0
  const [baseMin, baseMax, tierMultiplier] = upgradeType === 'level' ? [90, 60, 0.5] : [85, 75, 0.58]

  const chance = (baseMin - t * (baseMin - baseMax)) * tierMultiplier ** qualityIndex
  return Math.min(99, Math.max(1, chance))
}

// Master Forge (2026-08-05, confirmed with the user: "a Forge master will
// offer to 100% upgrade a piece of gear but it costs 150% of whatever the
// on-rate success rate would be for doing it manually") — 1.5x the expected
// manual cost (1 / success_chance, since a manual attempt costs 1 currency
// regardless of outcome), rounded up. Mirrors master_forge_upgrade's own
// cost formula exactly — must stay in sync.
export function previewMasterForgeCost(successChancePct: number): number {
  return Math.ceil((1 / (successChancePct / 100)) * 1.5)
}

// Mirrors upgrade_chain_family in 20260807020000_lucky_bow_chains_into_bow.sql
// — Lucky Bow is a standalone singleton family (so it stays out of the
// random kill-drop pool, see NON_DROPPABLE_FAMILIES), but its Level Upgrade
// target lives in the real 'bow' chain instead of its own single-template
// family. Every other family chains into itself, unchanged.
function chainFamily(itemFamily: string): string {
  return itemFamily === 'lucky-bow' ? 'bow' : itemFamily
}

// Client-side mirror of level_upgrade's next-template lookup (see
// 20260730020000_level_upgrade_next_tier.sql) — the next template sharing this
// one's item_family (via chainFamily above) with the lowest required_level
// above it, or null if this is already the top of its chain (or has no chain
// at all, e.g. item_family is null). Used only for the Forge's
// preview/disabled-state, never to decide the actual outcome — the RPC is
// still the source of truth.
export function findNextTemplateInChain(templates: ItemTemplate[], current: ItemTemplate): ItemTemplate | null {
  if (!current.item_family) {
    return null
  }

  const family = chainFamily(current.item_family)

  return (
    templates
      .filter((template) => template.item_family === family && template.required_level > current.required_level)
      .sort((a, b) => a.required_level - b.required_level)[0] ?? null
  )
}

// Composition (see CLAUDE.md's Gear system section) — a points accumulator with
// guaranteed progress and no RNG, distinct from Quality/Level Upgrade above.
// Mirrors composition_feed's SQL exactly (supabase/migrations/20260728000000_add_composition.sql,
// tier bound raised 4 -> 9 in 20260807080000_expand_composition_stone_tiers_to_9.sql)
// — keep in sync.
export const COMPOSITION_STONE_TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

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

// Stones are drag-and-drop inventory items now (see InventoryPanel/ForgeFuelZone),
// not a typed-in quantity — and confirmed to NOT stack: each stone is its own
// inventory tile/slot, not combined into one tile with a count badge. There's no
// per-stone UUID (the backend is still just a running total per tier on the
// character, characters.composition_stones), so each individual tile gets a
// synthetic id combining the tier with a render-time index (0..count-1) purely to
// give React a stable key and to let exactly *one* tile be reserved/dragged at a
// time — the index has no meaning beyond that, since same-tier stones are fully
// fungible. Dragging one tile always feeds exactly one stone of that tier; feeding
// more means dragging in more individual tiles.
const STONE_DRAG_ID_PREFIX = 'stone:'

export function stoneDragId(tier: number, index: number): string {
  return `${STONE_DRAG_ID_PREFIX}${tier}:${index}`
}

// Only the tier matters for feed/point-value purposes — the index is discarded.
export function parseStoneDragId(id: string): number | null {
  if (!id.startsWith(STONE_DRAG_ID_PREFIX)) {
    return null
  }

  const [tierPart] = id.slice(STONE_DRAG_ID_PREFIX.length).split(':')
  const tier = Number(tierPart)
  return (COMPOSITION_STONE_TIERS as readonly number[]).includes(tier) ? tier : null
}

// Real art (2026-08-07) for all 9 tiers, in ascending order of rarity
// (rough stone -> clear -> amber -> blue crystal -> red gem -> green gem ->
// cosmic/starfield orb -> purple crystal -> gold diamond).
const STONE_ICON_SRC_BY_TIER: Partial<Record<number, string>> = {
  1: `${import.meta.env.BASE_URL}item-icons/composition-stone-1.png`,
  2: `${import.meta.env.BASE_URL}item-icons/composition-stone-2.png`,
  3: `${import.meta.env.BASE_URL}item-icons/composition-stone-3.png`,
  4: `${import.meta.env.BASE_URL}item-icons/composition-stone-4.png`,
  5: `${import.meta.env.BASE_URL}item-icons/composition-stone-5.png`,
  6: `${import.meta.env.BASE_URL}item-icons/composition-stone-6.png`,
  7: `${import.meta.env.BASE_URL}item-icons/composition-stone-7.png`,
  8: `${import.meta.env.BASE_URL}item-icons/composition-stone-8.png`,
  9: `${import.meta.env.BASE_URL}item-icons/composition-stone-9.png`,
}

export function getStoneIconSrc(tier: number): string | undefined {
  return STONE_ICON_SRC_BY_TIER[tier]
}

// Universal Diablo/PoE-style tooltip content for a single stone — see
// buildGearTooltip in equipmentBonus.ts for the gear equivalent.
export function buildStoneTooltip(tier: number): ItemTooltipData {
  return {
    title: `+${tier} Stone`,
    icon: '🔷',
    iconSrc: getStoneIconSrc(tier),
    iconColor: MATERIAL_COLOR,
    lines: ['Composition material'],
    stats: [`${compositionPointValue(tier)} pts`],
  }
}

// Comets/Fallen Stars are individual, non-stacking Inventory items now (confirmed
// with the user, 2026-07-31 — see CLAUDE.md's Warehouse economy redesign note),
// same pattern as Composition Stones above: no per-unit id in the backend (just a
// running count, characters.comet_count/fallen_star_count), so each rendered tile
// gets a synthetic id combining the currency with a render-time index, purely for
// a stable React key — same-currency units are fully fungible, the index has no
// other meaning.
const COMET_DRAG_ID_PREFIX = 'comet:'
const FALLEN_STAR_DRAG_ID_PREFIX = 'fallen_star:'

export function cometDragId(index: number): string {
  return `${COMET_DRAG_ID_PREFIX}${index}`
}

export function fallenStarDragId(index: number): string {
  return `${FALLEN_STAR_DRAG_ID_PREFIX}${index}`
}

// Used by Forge's Material slot (ForgePanel.tsx) to tell a dragged Comet/
// Fallen Star tile apart from a stone/gear fuel tile — the prefix check is
// safe against the Scroll ids below (e.g. "fallen_star-scroll:0") since those
// have "-scroll" right after the currency name, not a colon.
export function isCometDragId(id: string): boolean {
  return id.startsWith(COMET_DRAG_ID_PREFIX)
}

export function isFallenStarDragId(id: string): boolean {
  return id.startsWith(FALLEN_STAR_DRAG_ID_PREFIX)
}

// Real art (2026-08-02), supersedes the 🌠/🔮 emoji everywhere a Comet/
// Fallen Star tile renders (InventoryPanel's grid + detail card,
// LootHoldingCard) — pass to InventorySlot's iconSrc prop, which takes
// priority over its emoji icon prop.
export const COMET_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/comet.png`
export const FALLEN_STAR_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/fallen-star.png`

// Own distinct border/glow colors (2026-08-02), same InventorySlot
// qualityColor mechanism gear uses for its tier tint — materials previously
// rendered with the same plain slate border as an empty/generic tile, giving
// them no visual identity of their own. Fallen Star reuses the old (pre-
// recalibration) Ascended orange at the user's request.
export const FALLEN_STAR_COLOR = '#F0B87A'

// Revised same day, per the user: Comet's own green was reassigned to
// Consumables instead (a broader category the user wants visually unified as
// green), and "all other materials" — Comet, Composition Stones, and
// (once built) Gems — now share one color instead of each getting its own:
// the old (pre-recalibration) Infused Silver, the user's specific pick from
// that retired palette. Distinct from FALLEN_STAR_COLOR (still its own
// orange, not folded into this) and from every QUALITY_COLORS value.
export const MATERIAL_COLOR = '#C8D0DC'

// Potions (HP/Mana) — see potionTypes.ts/InventoryPanel.tsx's potion tiles.
export const CONSUMABLE_COLOR = '#4ADE80'

export function buildCometTooltip(): ItemTooltipData {
  return {
    title: 'Comet',
    iconSrc: COMET_ICON_SRC,
    iconColor: MATERIAL_COLOR,
    lines: ['Forge material'],
    stats: ['Used for Level Upgrade'],
  }
}

export function buildFallenStarTooltip(): ItemTooltipData {
  return {
    title: 'Fallen Star',
    iconSrc: FALLEN_STAR_ICON_SRC,
    iconColor: FALLEN_STAR_COLOR,
    lines: ['Forge material'],
    stats: ['Used for Quality Upgrade'],
  }
}

// Comet Scroll / Fallen Star Scroll (stage 2 of the Warehouse economy
// redesign, 2026-07-31) — a compact-storage bundle of 10 loose units into 1
// non-stacking Inventory item. Same synthetic-id convention as the units
// themselves (no per-unit DB row, just a running count —
// characters.comet_scroll_count/fallen_star_scroll_count).
const COMET_SCROLL_DRAG_ID_PREFIX = 'comet-scroll:'
const FALLEN_STAR_SCROLL_DRAG_ID_PREFIX = 'fallen_star-scroll:'

export function cometScrollDragId(index: number): string {
  return `${COMET_SCROLL_DRAG_ID_PREFIX}${index}`
}

export function fallenStarScrollDragId(index: number): string {
  return `${FALLEN_STAR_SCROLL_DRAG_ID_PREFIX}${index}`
}

// Same purpose as isCometDragId/isFallenStarDragId above — used by the
// Marketplace's "List an Item" drop zone to tell a dragged Scroll tile apart
// from a loose unit or gear item.
export function isCometScrollDragId(id: string): boolean {
  return id.startsWith(COMET_SCROLL_DRAG_ID_PREFIX)
}

export function isFallenStarScrollDragId(id: string): boolean {
  return id.startsWith(FALLEN_STAR_SCROLL_DRAG_ID_PREFIX)
}

// Real art (2026-08-07), supersedes the 📜 emoji everywhere a Scroll tile
// renders — same iconSrc-over-icon priority as COMET_ICON_SRC/
// FALLEN_STAR_ICON_SRC above.
export const COMET_SCROLL_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/comet-scroll.png`
export const FALLEN_STAR_SCROLL_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/fallen-star-scroll.png`

export function buildCometScrollTooltip(): ItemTooltipData {
  return {
    title: 'Comet Scroll',
    iconSrc: COMET_SCROLL_ICON_SRC,
    iconColor: MATERIAL_COLOR,
    lines: ['Compact storage'],
    stats: ['Holds 10 Comets — Open to unbundle'],
  }
}

export function buildFallenStarScrollTooltip(): ItemTooltipData {
  return {
    title: 'Fallen Star Scroll',
    iconSrc: FALLEN_STAR_SCROLL_ICON_SRC,
    iconColor: FALLEN_STAR_COLOR,
    lines: ['Compact storage'],
    stats: ['Holds 10 Fallen Stars — Open to unbundle'],
  }
}

// Gear's "Deposit as Composition" path (stage 4 of the Warehouse economy
// redesign, 2026-07-31) — six separate, non-fungible per-slot-type point
// pools (characters.gear_composition_points jsonb), distinct from the shared
// bank_points balance stones/"Deposit as Item" tokens liquidate into. A
// Ring's points can only ever buy back a Ring, never a Coat. Same point-value/
// cost formulas as Composition/Stones (compositionPointValue/
// compositionPointsRequired above) — mirrors deposit_item_as_composition/
// withdraw_gear_composition's SQL; keep in sync.
export const GEAR_SLOT_TYPES = ['weapon', 'ring', 'necklace', 'boots', 'hat', 'coat'] as const
export type GearSlotType = (typeof GEAR_SLOT_TYPES)[number]

export type GearCompositionPoints = Record<GearSlotType, number>

export const DEFAULT_GEAR_COMPOSITION_POINTS: GearCompositionPoints = {
  weapon: 0,
  ring: 0,
  necklace: 0,
  boots: 0,
  hat: 0,
  coat: 0,
}

const GEAR_SLOT_LABELS: Record<GearSlotType, string> = {
  weapon: 'Weapon',
  ring: 'Ring',
  necklace: 'Necklace',
  boots: 'Boots',
  hat: 'Hat',
  coat: 'Coat',
}

export function formatGearSlotLabel(slotType: GearSlotType): string {
  return GEAR_SLOT_LABELS[slotType]
}
