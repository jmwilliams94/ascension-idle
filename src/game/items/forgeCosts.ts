import type { ItemTooltipData } from './itemTooltip'
import type { ItemTemplate } from './useItemTemplatesStore'
import { getGearIconSrc } from './equipmentBonus'
import { APP_VERSION } from '../../version'

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

// A weapon at required_level 120+ is Master-Forge-exclusive (2026-08-31,
// migration 20260831010000_weapon_120_master_forge_only.sql — keep in sync):
// the regular Forge tile (single attempt AND Comet Scroll batch) refuses it
// outright with the 'weapon_requires_master_forge' error, and Master Forge
// charges a flat 1 Fallen Star per level instead of the usual Comet/cost
// formula (see previewMasterForgeLevelCost below). This helper doubles as
// both "which currency does Master Forge charge" and "does the regular Forge
// need to redirect the player to Master Forge" — both are the same
// slotType==='weapon' && requiredLevel>=120 condition. Every other Level
// Upgrade (non-weapon, or a weapon below 120) is unchanged, still 1 Comet.
export type UpgradeCurrency = 'comet' | 'fallen_star'

export function levelUpgradeCurrency(slotType: string | null | undefined, requiredLevel: number | null | undefined): UpgradeCurrency {
  return slotType === 'weapon' && typeof requiredLevel === 'number' && requiredLevel >= 120 ? 'fallen_star' : 'comet'
}

// Flat cost for Master Forge's weapon-120+ branch — no RNG cost formula,
// since there's no more "manual" Forge cost to price 1.5x of past this
// point (mirrors master_forge_upgrade's SQL `v_cost := 1` override).
export function previewMasterForgeWeaponLevelCost(): number {
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
// Level Upgrade: 100% (item's own level is the lowest in its family chain) to
// 80% (highest), halved again for every quality tier above Normal (raised
// from 95%/75% 2026-08-21, per the user — the low end is now a true
// guaranteed-success roll, see the maxChance override below). Quality
// Upgrade: 85% to 75% by the same level-position logic, x0.58 per quality
// tier above Normal (retuned 2026-08-19 from x0.65 — the user asked for
// Radiant->Ascended specifically to land "closer to the 15% mark," which
// x0.58 does almost exactly: ~14.6-16.6%). Both PLACEHOLDER curves, same
// disclosed-not-final status as every other economy number in this game.
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
  // Level Upgrade's low end is a deliberate guaranteed-success roll (maxChance
  // 100); Quality Upgrade keeps the "never literally guaranteed" clamp (99).
  const [baseMin, baseMax, tierMultiplier, maxChance] = upgradeType === 'level' ? [100, 80, 0.5, 100] : [85, 75, 0.58, 99]

  const chance = (baseMin - t * (baseMin - baseMax)) * tierMultiplier ** qualityIndex
  return Math.min(maxChance, Math.max(1, chance))
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

// Shared by Master Forge (unconditional) and the plain Forge tile
// (equipped-items-only, see ForgeStandardPanel.tsx) — a Level Upgrade result
// whose required_level would exceed the character's own level. Mirrors the
// `v_next_required_level > v_character_level` check in master_forge_upgrade/
// level_upgrade's SQL — keep in sync.
export function exceedsCharacterLevel(nextTemplate: ItemTemplate | null, characterLevel: number): boolean {
  return Boolean(nextTemplate && nextTemplate.required_level > characterLevel)
}

// Composition (see CLAUDE.md's Gear system section) — a points accumulator with
// guaranteed progress and no RNG, distinct from Quality/Level Upgrade above.
// Mirrors composition_feed's SQL exactly (supabase/migrations/20260728000000_add_composition.sql,
// tier bound raised 4 -> 9 in 20260807080000_expand_composition_stone_tiers_to_9.sql)
// — keep in sync.
export const COMPOSITION_STONE_TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

// Real Conquer-sourced values (2026-08-11, replacing the earlier flat
// 10 * 3^(N-1) formula — see CLAUDE.md's Gear system section; the sourced
// table was previously reviewed and rejected, then re-confirmed as wanted
// after all). A stone of tier 1 is worth 10 points; tiers 2+ are worth
// 40 * 3^(N-2) (40, 120, 360, 1080, 3240, 9720, 29160 for tiers 2-8, matching
// the source table exactly). A fuel item's own composition_level values the
// same way (Normal/level 0 contributes nothing). The source table only goes
// to tier 8 — tiers 9-12 continue the same x3 step per level, since nothing
// else is sourced.
export function compositionPointValue(level: number): number {
  if (level <= 0) {
    return 0
  }
  if (level === 1) {
    return 10
  }
  return 40 * 3 ** (level - 2)
}

// Composition now hard-caps at +12 (2026-08-11, per the same sourced table
// below — there's no data past +12).
export const COMPOSITION_MAX_LEVEL = 12

// Real Conquer-sourced values (2026-08-11) — a genuine lookup table, not a
// closed-form formula, since the source data has a deliberate discontinuity
// at +9->+10 (drops from the x3 exponential pattern below it to a much
// smaller flat-ish ramp above it) that no formula reproduces. Index i is the
// cost to advance from level i to i+1; index 11 (+11->+12) is the last
// defined step.
const COMPOSITION_POINTS_REQUIRED_BY_LEVEL = [20, 20, 80, 240, 720, 2160, 6480, 19440, 58320, 2700, 5500, 9000] as const

// Returns 0 once currentLevel is at or beyond COMPOSITION_MAX_LEVEL — ProgressBar
// (ForgeCompositionPanel.tsx) already treats a 0 "required" as a complete/100% bar.
export function compositionPointsRequired(currentLevel: number): number {
  return COMPOSITION_POINTS_REQUIRED_BY_LEVEL[currentLevel] ?? 0
}

export function isCompositionMaxed(level: number): boolean {
  return level >= COMPOSITION_MAX_LEVEL
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

  while (!isCompositionMaxed(level)) {
    const required = compositionPointsRequired(level)
    if (points < required) {
      break
    }
    points -= required
    level += 1
  }

  return { level, points, required: compositionPointsRequired(level) }
}

export interface CompositionFeedStep {
  // Tier this step fills — the step's own before/after points are always
  // read against compositionPointsRequired(level) for THIS level, since
  // each tier has its own points scale.
  level: number
  fromPoints: number
  toPoints: number
  required: number
}

// Same tier-up loop as simulateCompositionFeed, but returns every intermediate
// tier crossed rather than just the final result — used by CompositionLoadBar's
// confirm animation to play the fill through each tier one at a time instead of
// jumping straight to the end state. A feed that stays within the current tier
// (the common case) yields exactly one step; a feed large enough to complete N
// tiers before landing on a final partial one yields N+1.
export function simulateCompositionFeedSteps(currentLevel: number, currentPoints: number, addedPoints: number): CompositionFeedStep[] {
  const steps: CompositionFeedStep[] = []
  let level = currentLevel
  let points = currentPoints
  let remaining = addedPoints

  while (remaining > 0 && !isCompositionMaxed(level)) {
    const required = compositionPointsRequired(level)
    const neededToComplete = required - points

    if (remaining < neededToComplete) {
      steps.push({ level, fromPoints: points, toPoints: points + remaining, required })
      points += remaining
      remaining = 0
    } else {
      steps.push({ level, fromPoints: points, toPoints: required, required })
      remaining -= neededToComplete
      points = 0
      level += 1
    }
  }

  return steps
}

// Confirm-animation pacing for CompositionLoadBar — the first tier's fill
// (color transition from the tentative white bar to committed amber) always
// gets a full second, matching the original single-tier confirm feel;
// additional tiers cascade faster since they're just playing out an already-
// decided result. ForgeCompositionTab's minimum feed delay is derived from
// this so the network response never cuts the animation short.
export const COMPOSITION_FEED_FIRST_STEP_SECONDS = 1
export const COMPOSITION_FEED_STEP_SECONDS = 0.5

// Whenever a step completes a tier, CompositionLoadBar holds a white "+N"
// number pop-up on screen for COMPOSITION_FEED_NUMBER_HOLD_MS, fades it out
// over COMPOSITION_FEED_NUMBER_FADE_MS, then pauses COMPOSITION_FEED_STEP_RESET_MS
// longer before the bar resets to 0% and starts loading the next tier (if
// there is one) — the pop-up finishing is what gates the next segment
// starting, not a fixed timer independent of it.
export const COMPOSITION_FEED_NUMBER_HOLD_MS = 1000
export const COMPOSITION_FEED_NUMBER_FADE_MS = 300
export const COMPOSITION_FEED_STEP_RESET_MS = 150

// Padding added on top of the raw duration sum. Without it, the parent's
// setTimeout(minDelayMs) and CompositionLoadBar's own framer-motion await can
// resolve in either order — if the parent flips `confirming` off first, the
// bar's confirm effect gets torn down (cancelled = true) a tick before its
// final controls.start() await resolves, so the tier-complete ember burst
// never spawns and the bar just snaps back to the (already-advanced) real
// position with no firework. This buffer keeps the internal animation
// reliably finishing before that happens.
const COMPOSITION_FEED_END_BUFFER_MS = 400

// Sums each step's fill duration, plus — for every step that completes a
// tier — the number pop-up's hold+fade+reset pause that follows it (whether
// or not another step comes after; the trailing pop-up on the very last step
// still needs time to play out before the parent flips `confirming` off).
// Takes the actual steps (not just a count) since only completing steps get
// that extra pause — the common case (one step, no completion) stays a
// snappy ~1s wait.
export function estimateCompositionFeedAnimationMs(steps: CompositionFeedStep[]): number {
  if (steps.length === 0) {
    return 0
  }

  const total = steps.reduce((sum, step, i) => {
    const fillMs = (i === 0 ? COMPOSITION_FEED_FIRST_STEP_SECONDS : COMPOSITION_FEED_STEP_SECONDS) * 1000
    const completesTier = step.toPoints >= step.required
    const pauseMs = completesTier ? COMPOSITION_FEED_NUMBER_HOLD_MS + COMPOSITION_FEED_NUMBER_FADE_MS + COMPOSITION_FEED_STEP_RESET_MS : 0
    return sum + fillMs + pauseMs
  }, 0)

  return total + COMPOSITION_FEED_END_BUFFER_MS
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
// Comet Box (2026-08-14) — the Lucky Lad reward kind gets its own dedicated
// chest-and-scroll icon rather than reusing the plain Comet icon above,
// everywhere it's shown (LuckyPanel board tile/tooltip, InventoryPanel's
// tile, GlobalAnnouncementTicker). `?v=${APP_VERSION}` cache-busts it (see
// navIcons.ts's `iconUrl` doc comment) — added after the art at this same
// filename had to be corrected once already the same day (wrong source
// image swapped in initially).
//
// Redesigned 2026-08-25 (requested by the user) from an instant +100 Comets
// grant into a real inventory item, same virtual-tile pattern as Comet
// Scroll below (characters.comet_box_count) — see buildCometBoxTooltip
// further down for its own drag-id/tooltip helpers, placed alongside Comet
// Scroll's since they share the exact same mechanic shape.
export const COMET_BOX_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/comet-box.png?v=${APP_VERSION}`

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

// Every Forge currency-affordability check (regular Quality/Level Upgrade,
// Master Forge, weapon Socket unlock) must count Scrolls toward what a
// player can afford, not just loose units — the server side already does
// this (quality_upgrade/level_upgrade/master_forge_upgrade/
// unlock_weapon_socket all call ensure_loose_currency, which auto-unbundles
// exactly enough Scrolls to cover a shortfall before its cost check runs).
// A client-side preview that only looks at loose comets/fallenStars blocks
// the Confirm button on a genuinely affordable action — a real bug, fixed
// 2026-08-07 (reported by the user: "it's not picking up that I have 4
// Comet Scrolls... it seems it can only see the 6 individual comets").
export const SCROLL_UNIT_VALUE = 10

export function effectiveCurrencyAvailable(looseUnits: number, scrollCount: number): number {
  return looseUnits + scrollCount * SCROLL_UNIT_VALUE
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

// Comet Box (redesigned 2026-08-25, requested by the user, from an instant
// +100 Comets grant into a real inventory item) — same virtual-tile pattern
// as Comet Scroll above: no per-unit id in the backend, just a running count
// (characters.comet_box_count), so each rendered tile gets a synthetic id
// combining the currency with a render-time index, purely for a stable React
// key. Distinct from Comet Scroll's own "Open" (unbundles into 10 loose
// Comets on the character itself) — opening a Comet Box instead grants a
// flat 100 Comets straight into the account-wide Bank balance
// (players.bank_comets, see open_comet_box), never the character's own loose
// comet_count.
export const COMET_BOX_REWARD_AMOUNT = 100
const COMET_BOX_DRAG_ID_PREFIX = 'comet-box:'

export function cometBoxDragId(index: number): string {
  return `${COMET_BOX_DRAG_ID_PREFIX}${index}`
}

export function isCometBoxDragId(id: string): boolean {
  return id.startsWith(COMET_BOX_DRAG_ID_PREFIX)
}

export function buildCometBoxTooltip(): ItemTooltipData {
  return {
    title: 'Comet Box',
    iconSrc: COMET_BOX_ICON_SRC,
    iconColor: MATERIAL_COLOR,
    lines: ['Lucky Lad reward'],
    stats: [`Open for ${COMET_BOX_REWARD_AMOUNT} Account Bank Comets`],
  }
}

// VIP Token (groundwork only, requested by the user) — same virtual-tile
// pattern as Comet Box above (characters.vip_token_count, no per-unit DB
// row). Consuming one adds VIP_TOKEN_DURATION_DAYS to characters.vip_expires_at
// (see use_vip_token) — VIP itself grants no gameplay bonuses yet, this is
// groundwork only. No real art yet (no Gem-style "user-supplied" asset
// exists for this), so it uses a plain emoji icon, same as Lottery Ticket.
export const VIP_TOKEN_DURATION_DAYS = 30
export const VIP_TOKEN_COLOR = '#facc15'
const VIP_TOKEN_DRAG_ID_PREFIX = 'vip-token:'

export function vipTokenDragId(index: number): string {
  return `${VIP_TOKEN_DRAG_ID_PREFIX}${index}`
}

export function isVipTokenDragId(id: string): boolean {
  return id.startsWith(VIP_TOKEN_DRAG_ID_PREFIX)
}

export function buildVipTokenTooltip(): ItemTooltipData {
  return {
    title: 'VIP Token',
    icon: '👑',
    iconColor: VIP_TOKEN_COLOR,
    lines: ['Lucky Lad reward'],
    stats: [`Use to add ${VIP_TOKEN_DURATION_DAYS} days of VIP`],
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

// Money Bag / Random Gem Bag (Lucky Lad rewards expansion, 2026-08-09) — real
// item_templates/item_instances rows (not a stackable jsonb counter like
// Comets/Stones), each consumed via an "Open" action (open_reward_item RPC)
// same as a Comet/Fallen Star Scroll's "Open" unbundles it. goldValue comes
// from the owning template's own `price` column (reused rather than adding a
// new schema column — Money Bags are never Shop-listed, so no collision).
export function buildMoneyBagTooltip(className: string, goldValue: number): ItemTooltipData {
  return {
    title: className,
    icon: '💰',
    iconSrc: getGearIconSrc(className),
    iconColor: FALLEN_STAR_COLOR,
    lines: ['Lucky Lad reward'],
    stats: [`Open for ${goldValue.toLocaleString()} gold`],
  }
}

export function buildGemBagTooltip(): ItemTooltipData {
  return {
    title: 'Random Gem Bag',
    icon: '🎁',
    iconSrc: getGearIconSrc('Random Gem Bag'),
    iconColor: MATERIAL_COLOR,
    lines: ['Lucky Lad reward'],
    stats: ['Open for 1 random Normal gem'],
  }
}

// Client-side mirror of the Class 1-10 Money Bag gold ramp (item_templates.price,
// seeded/updated in the Lucky Lad migrations) — needed only for LuckyPanel's
// pre-open board tooltip, which has no real item_instances/item_templates row
// to read a live price from yet (the board is just {kind, amount} pairs).
// Once opened, the real tooltip elsewhere always reads the live template
// price instead of this table. Must stay in sync with whichever migration
// last updated the Money Bag prices.
export const MONEY_BAG_GOLD_BY_CLASS: Record<number, number> = {
  1: 50000,
  2: 100000,
  3: 200000,
  4: 400000,
  5: 800000,
  6: 1500000,
  7: 3000000,
  8: 6000000,
  9: 9000000,
  10: 15000000,
}
