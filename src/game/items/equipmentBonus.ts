import { CLASS_DEFINITIONS, type ClassId } from '../stats/classes'
import type { EquipmentBonus } from '../stats/derivedStats'
import { DEFAULT_STAT_COLOR, type ItemTooltipData, type TooltipLine } from './itemTooltip'
import type { ItemInstance } from './useInventoryStore'
import type { ItemTemplate } from './useItemTemplatesStore'
import { EQUIP_SLOTS, type EquipSlot } from './useEquipmentStore'
import { damageRangeFromMidpoint } from '../combat/combatResolver'
import { describeSocketedGem, SOCKETED_GEM_COLOR, sumSocketedGemBonusPct, ENCHANT_HP_RANGE_BY_TIER, BLESS_PCT_STEPS } from './gemCatalog'

// Plain white, used for a handful of gear tooltip lines that should read as
// neutral/informational rather than tinted (Lvl, Class, the "Sockets"
// header, the Physical Defense/Dodge/Physical Attack/Dexterity stat lines
// below, and the Progression line) — per the user's 2026-08-13/2026-08-14
// tooltip color passes. Magic Attack/Defense are deliberately left at the
// block's own default blue.
const TOOLTIP_WHITE = '#FFFFFF'

// Lock (requested by the user) — amber, matching the app's existing
// "claimable"/attention-worthy amber accent (#f59e0b, see AchievementsPanel's
// CHIP_STATE_COLOR) rather than inventing a new color for this.
const LOCKED_LINE_COLOR = '#f59e0b'

// Stat keys that get the white override above instead of the default stat
// block color (sky blue) — everything else in base_stats keeps that default.
const WHITE_STAT_KEYS = ['physical_defense', 'dodge', 'physical_attack', 'dexterity']

// Mirrors forgeCosts.ts's own COMPOSITION_POINTS_REQUIRED_BY_LEVEL/
// compositionPointsRequired/COMPOSITION_MAX_LEVEL — duplicated locally rather
// than imported, since forgeCosts.ts itself imports getGearIconSrc from this
// file, and importing back the other way would create a circular import
// (same reasoning as the gemCatalog.ts/gemTypes.ts split — see CLAUDE.md's
// Gem system section). Keep this array in sync with forgeCosts.ts's copy.
const TOOLTIP_COMPOSITION_MAX_LEVEL = 12
const TOOLTIP_COMPOSITION_POINTS_REQUIRED_BY_LEVEL = [20, 20, 80, 240, 720, 2160, 6480, 19440, 58320, 2700, 5500, 9000] as const

// How much stronger each quality tier is than the template's stored (Normal-tier)
// base_stats — an approximate, rounded pattern (not any single sourced item's
// exact ratios), applied uniformly to every item rather than baked into a
// separate row per tier. This is what makes a quality upgrade actually do
// something mechanically — previously quality_tier was stored but never read
// here at all (a documented gap; see CLAUDE.md's Forge/Gear system notes).
//
// Recalibrated (2026-07-31) to actually match the confirmed real "battle-power
// weighting" reference already noted in CLAUDE.md (Refined=1, Unique=2,
// Elite=3, Super=4, Normal=0 baseline) — the previous 1/1.1/1.2/1.35/1.5
// values were an invented placeholder that never implemented that reference,
// which crushed to near-nothing on small low-level base stats (a real Ring
// item's Normal-to-Super gap roughly doubles the stat per co.99.com's rings
// guide, not +50%). Each multiplier here is 1 + weight/4, i.e. an additive
// step of base_stat/4 per battle-power point — mathematically an additive
// bonus scaled to the item's own base value, just expressed as a multiplier
// since that's all scaledStat needs.
export const QUALITY_STAT_MULTIPLIERS: Record<string, number> = {
  normal: 1,
  tempered: 1.25,
  infused: 1.5,
  radiant: 1.75,
  ascended: 2,
}

// Pickaxe-only quality curve (2026-08-27, requested by the user) — a flat
// 1/2/3/4/5x ladder, deliberately steeper than every other gear slot's
// QUALITY_STAT_MULTIPLIERS above. Scoped to the Pickaxe specifically (not a
// global rebalance): Pickaxe never enters computeEquipmentBonus at all (not
// in EQUIP_SLOTS, has its own dedicated equip slot since v1.113.0), so this
// only affects mining damage (useMiningStore.ts, mirrored server-side in
// resolve-mining/index.ts) and this file's own tooltip-stat display below.
export const PICKAXE_QUALITY_MULTIPLIERS: Record<string, number> = {
  normal: 1,
  tempered: 2,
  infused: 3,
  radiant: 4,
  ascended: 5,
}

function scaledStat(baseStats: Record<string, number>, key: string, qualityTier: string, itemFamily?: string | null): number | undefined {
  const base = baseStats[key]
  if (typeof base !== 'number') {
    return undefined
  }
  const table = itemFamily === 'pickaxe' ? PICKAXE_QUALITY_MULTIPLIERS : QUALITY_STAT_MULTIPLIERS
  const multiplier = table[qualityTier] ?? 1
  return Math.round(base * multiplier)
}

// Composition ("+N") stat bonus — confirmed 2026-08-11, 5%/tier flat
// placeholder (see CLAUDE.md's Composition section), tiers currently
// uncapped. Deliberately computed off the item's raw, unscaled base_stats
// (not scaledStat's quality-adjusted value) and kept out of
// computeEquipmentBonus's/resolve-combat's other multipliers entirely — it
// must not compound with QUALITY_STAT_MULTIPLIERS or the account-wide
// attack/drop bonus percentages, per the user's explicit "not included in
// any other scaling" — so it's summed as its own flat addend, not folded
// into scaledStat.
//
// Slot -> stat key mapping mirrors the sourced per-slot-type table in
// CLAUDE.md; only the base_stats keys this codebase actually reads today are
// included (Max HP portions of Necklace/Bag aren't itemized on any template
// yet). Ring lists both attack keys because Wuxia's Bracelet (item_family
// 'bracelet', also slot_type 'ring') carries magic_attack instead of Hunter's
// Ring's physical_attack — computeCompositionBonusStats below only awards a
// bonus for a key actually present on that item's own base_stats, so this is
// a no-op for whichever of the two an item doesn't have (2026-08-26, see
// 20261016000000_fix_wuxia_backsword_bracelet_stats.sql).
// Raised 5% -> 10%/tier (2026-11, requested by the user as part of the
// weapon-curve/enemy-HP rebalance) -- at 5% it barely moved the needle for
// even a heavily-invested character (max composition + best gems still only
// shaved 1 hit off a fight), so it wasn't pulling its weight as a real
// upgrade-path incentive.
export const COMPOSITION_BONUS_PCT_PER_TIER = 0.10

export const COMPOSITION_BONUS_STAT_KEYS: Record<string, string[]> = {
  weapon: ['physical_attack', 'magic_attack'],
  ring: ['physical_attack', 'magic_attack'],
  necklace: ['physical_defense'],
  hat: ['physical_defense'],
  coat: ['physical_defense', 'magic_defense'],
  boots: ['dodge'],
  pickaxe: ['physical_attack'],
}

// Returns only keys with a nonzero rounded bonus (a level-1 item's tiny base
// stat can legitimately round to +0 at low composition levels — omitted
// rather than shown as a no-op "Bonus: +0").
export function computeCompositionBonusStats(
  baseStats: Record<string, number>,
  slotType: string | undefined,
  compositionLevel: number,
): Record<string, number> {
  if (!slotType || compositionLevel <= 0) {
    return {}
  }
  const keys = COMPOSITION_BONUS_STAT_KEYS[slotType]
  if (!keys) {
    return {}
  }
  const result: Record<string, number> = {}
  for (const key of keys) {
    const base = baseStats[key]
    if (typeof base !== 'number') continue
    const bonus = Math.round(base * COMPOSITION_BONUS_PCT_PER_TIER * compositionLevel)
    if (bonus > 0) {
      result[key] = bonus
    }
  }
  return result
}

// Pure function taking explicit snapshots rather than reading the stores itself, so
// it works both reactively (React components, fed by hooks) and imperatively (Phaser
// scene code, fed by .getState()) without duplicating the lookup logic.
//
// Multi-slot (confirmed, 2026-07-31) — supersedes the earlier single-item
// version now that Ring/Necklace/Boots/Hat/Coat are functional alongside Main
// Hand: sums physical_attack/magic_attack/physical_defense/dodge across every
// equipped slot rather than reading one item, since a full loadout can now
// mix a weapon+ring (attack) with necklace/hat/coat (defense) and boots
// (dodge) simultaneously.
export function computeEquipmentBonus(
  equippedIds: Record<EquipSlot, string | null>,
  items: ItemInstance[],
  templates: ItemTemplate[],
): EquipmentBonus {
  const bonus: Required<EquipmentBonus> = {
    physicalAttack: 0,
    magicAttack: 0,
    physicalDefense: 0,
    magicDefense: 0,
    dodge: 0,
    dexterity: 0,
    compositionPhysicalAttackBonus: 0,
    compositionMagicAttackBonus: 0,
    drakeBonusPct: 0,
    emberBonusPct: 0,
    bastionBonusPct: 0,
    irisBonusPct: 0,
    enchantHpBonus: 0,
    gearHpBonus: 0,
    blessDamageReductionPct: 0,
  }

  for (const slot of EQUIP_SLOTS) {
    const itemId = equippedIds[slot]
    if (!itemId) continue

    const item = items.find((entry) => entry.id === itemId)
    const template = item && templates.find((entry) => entry.id === item.template_id)
    if (!item || !template) continue

    // Broken gear (2026-08-14, Durability) contributes nothing at all — same
    // as if the slot were empty — mirrored in resolve-combat/index.ts's own
    // equipped-items loop for the server-authoritative side.
    if ((item.durability ?? 0) <= 0) continue

    const itemEnchant = item.enchant as { hp?: number; blessPct?: number } | null
    bonus.enchantHpBonus += itemEnchant?.hp ?? 0
    bonus.blessDamageReductionPct += itemEnchant?.blessPct ?? 0

    bonus.physicalAttack += scaledStat(template.base_stats, 'physical_attack', item.quality_tier) ?? 0
    bonus.magicAttack += scaledStat(template.base_stats, 'magic_attack', item.quality_tier) ?? 0
    bonus.physicalDefense += scaledStat(template.base_stats, 'physical_defense', item.quality_tier) ?? 0
    bonus.magicDefense += scaledStat(template.base_stats, 'magic_defense', item.quality_tier) ?? 0
    bonus.dodge += scaledStat(template.base_stats, 'dodge', item.quality_tier) ?? 0
    bonus.dexterity += scaledStat(template.base_stats, 'dexterity', item.quality_tier) ?? 0
    // Shield's flat "Life" stat (Juggernaut's second-hand slot) — see
    // derivedStats.ts's gearHpBonus comment for why this is a separate field
    // from Enchant's own HP roll rather than merged into it.
    bonus.gearHpBonus += scaledStat(template.base_stats, 'max_hp', item.quality_tier) ?? 0

    // Physical/magic attack composition bonus is tracked separately per type
    // (compositionPhysicalAttackBonus/compositionMagicAttackBonus) rather
    // than folded into bonus.physicalAttack/magicAttack — those two feed
    // attackMidpoint, which the account-wide attack bonus % then multiplies
    // (see useCombatStore.runTick); the composition bonus must not be swept
    // into that multiplication (per the user's "not included in any other
    // scaling"), so it's added back in unscaled afterward instead. Kept
    // split by type (not merged into one blob, 2026-08-26) so Drake/Ember's
    // own gem bonus % below can apply to the right one — physicalDefense/
    // magicDefense/dodge have no equivalent account-wide multiplier, so
    // their composition bonus is folded straight in.
    const composition = computeCompositionBonusStats(template.base_stats, template.slot_type, item.composition_level)
    bonus.compositionPhysicalAttackBonus += composition.physical_attack ?? 0
    bonus.compositionMagicAttackBonus += composition.magic_attack ?? 0
    bonus.physicalDefense += composition.physical_defense ?? 0
    bonus.magicDefense += composition.magic_defense ?? 0
    bonus.dodge += composition.dodge ?? 0

    // Socketed gem bonuses (2026-08-26, requested by the user — previously
    // wired into tooltips only, never any real combat math). Summed across
    // every equipped item's own sockets, additively per gem type. Drake/
    // Ember multiply into attackMidpoint (useCombatStore.runTick, after
    // quality tier and composition, per the user's explicit ordering).
    // Bastion is merged into damageReductionPct below (computeDerivedStats)
    // — same effect as the Enchantress's Bless bonus, just a second source,
    // so applyDamageReduction only ever needs one combined number. Iris is
    // passed through as its own field and applied as the final multiplier on
    // total EXP gained (see combatResolver.ts's expectedRewardPerAttack and
    // resolve-combat/index.ts's mirror) — no other reward source stacks with
    // it the way Bastion/Bless do for damage reduction.
    bonus.drakeBonusPct += sumSocketedGemBonusPct(item.sockets, 'drake')
    bonus.emberBonusPct += sumSocketedGemBonusPct(item.sockets, 'ember')
    bonus.bastionBonusPct += sumSocketedGemBonusPct(item.sockets, 'bastion')
    bonus.irisBonusPct += sumSocketedGemBonusPct(item.sockets, 'iris')
  }

  return bonus
}

// Gear Score (requested by the user) — client mirror of the SQL
// compute_item_gear_score function (20260930010000_gear_lock_and_gear_score.sql,
// socket table updated 20260824000000) — must stay in sync. Quality tier
// worth its QUALITY_ORDER index (0-4, same battle-power weighting already
// documented in CLAUDE.md), sockets worth 0/1/3 for 0/1/2 unlocked sockets
// (filled or empty — 2 sockets is a deliberate non-linear jump, not 2x),
// composition_level worth 1 per point (0-12), Enchant HP worth 1 point per
// tier range reached (0-3, ranges from ENCHANT_HP_RANGE_BY_TIER), Bless worth
// 1 point per ladder step reached (0-4, BLESS_PCT_STEPS) — matches the user's
// own worked example (1% -> 1pt, 5% -> 3pts) exactly.
const SOCKET_GEAR_SCORE_BY_COUNT: Record<number, number> = { 0: 0, 1: 1, 2: 3 }

export function computeItemGearScore(item: Pick<ItemInstance, 'quality_tier' | 'sockets' | 'composition_level' | 'enchant'>): number {
  const qualityScore = Math.max(0, QUALITY_ORDER.indexOf(item.quality_tier))
  const socketScore = SOCKET_GEAR_SCORE_BY_COUNT[item.sockets.length] ?? item.sockets.length
  const compositionScore = item.composition_level

  const enchant = item.enchant as { hp?: number; blessPct?: number } | null
  const enchantScore = !enchant?.hp
    ? 0
    : enchant.hp >= ENCHANT_HP_RANGE_BY_TIER.ascended.min
      ? 3
      : enchant.hp >= ENCHANT_HP_RANGE_BY_TIER.tempered.min
        ? 2
        : enchant.hp >= ENCHANT_HP_RANGE_BY_TIER.normal.min
          ? 1
          : 0
  const blessScore = enchant?.blessPct ? BLESS_PCT_STEPS.filter((step) => enchant.blessPct! >= step).length : 0

  return qualityScore + socketScore + compositionScore + enchantScore + blessScore
}

// Gear Score Snapshot (2026-09-30, requested by the user — supersedes an
// earlier "sum whatever's live-equipped" version): equipping a scored piece
// of gear freezes a copy of its scoring fields onto the character server-side
// (character_gear_snapshots, claim_gear_snapshot) — see useGearSnapshotStore.ts.
// This means taking gear off (a Pickaxe swap, bare-handed, whatever) never
// drops the score by itself, and the same physical item can't inflate more
// than one character's score by being walked across an account's roster —
// only one character can hold the claim at a time. Sums computeItemGearScore
// over the character's own snapshot rows (a snapshot entry has exactly the
// shape computeItemGearScore needs) rather than live equipped items.
export function computeGearScoreFromSnapshots(
  snapshots: Partial<Record<string, Pick<ItemInstance, 'quality_tier' | 'sockets' | 'composition_level' | 'enchant'>>>,
): number {
  return Object.values(snapshots).reduce<number>((sum, snapshot) => sum + (snapshot ? computeItemGearScore(snapshot) : 0), 0)
}

// Client-side mirror of sell_item's SQL formula (see
// 20261110010000_sell_price_durability_scaling.sql) — must stay in sync,
// same pattern as every other Forge/Shop cost preview in this codebase: half
// of the template's buy price, scaled by quality and by how much durability
// the item has left (durabilityFraction, 1 = full — the default, since most
// callers don't have real durability data on hand). Deliberately ignores
// composition level for now (a minimal first pass, not a full
// item-valuation redesign).
export function previewSellPrice(price: number, qualityTier: string, durabilityFraction = 1): number {
  return Math.round(price * 0.5 * (QUALITY_STAT_MULTIPLIERS[qualityTier] ?? 1) * durabilityFraction)
}

// Client-side mirror of salvage_item's SQL case statement (see
// 20260807060000_salvage_ap_table_and_bonus_rebalance.sql; the flat socket
// bonus added 20260824000000 was removed again 20261214000000 — sockets no
// longer affect salvage AP) — must stay in sync. Forge's Salvage tab: no
// gold, same per-tier AP as sell_item's gold payout (Salvage's only
// difference from Sell is forfeiting the gold). Gems/composition/enchant on
// the item are not refunded in any way, same as everything else lost on
// salvage.
const SALVAGE_AP_BY_QUALITY: Record<string, number> = {
  normal: 0,
  tempered: 1,
  infused: 2,
  radiant: 3,
  ascended: 4,
}

export function previewSalvageApValue(qualityTier: string): number {
  return SALVAGE_AP_BY_QUALITY[qualityTier] ?? 0
}

// Gear Durability (2026-08-14) — client mirror of the SQL compute_max_durability
// function (see the migration adding it) — must stay in sync. PLACEHOLDER
// category-based curve, loosely shaped like real Conquer reference data
// (rings run wider than armor, both plateau well before max level) without
// matching it exactly. Returns null for Quiver/anything unrecognized — it
// has no durability concept at all.
const DURABILITY_RANGE_BY_CATEGORY: Record<string, { base: number; cap: number }> = {
  weapon: { base: 10, cap: 70 },
  ring: { base: 10, cap: 70 },
  necklace: { base: 20, cap: 40 },
  boots: { base: 20, cap: 40 },
  hat: { base: 20, cap: 40 },
  coat: { base: 20, cap: 40 },
}
const DURABILITY_PLATEAU_LEVEL = 110

export function computeMaxDurability(slotType: string, requiredLevel: number): number | null {
  const range = DURABILITY_RANGE_BY_CATEGORY[slotType]
  if (!range) return null
  const t = Math.min(1, requiredLevel / DURABILITY_PLATEAU_LEVEL)
  return Math.round(range.base + (range.cap - range.base) * t)
}

// Whether a slot_type has a durability concept at all — used at every tile
// render site to decide whether "broken" is even a meaningful thing to show
// for this item (money bags/gem bags/Quiver/etc. all flow through the same
// generic tile components as real gear, but none of them have durability).
export function itemHasDurability(slotType: string | undefined): boolean {
  return Boolean(slotType && slotType in DURABILITY_RANGE_BY_CATEGORY)
}

// Client mirror of the SQL compute_repair_cost function — must stay in sync.
// Rescaled 2026-08-14 (requested by the user: "level 130 gear should cost
// like 100k per piece if their durability is at 0... early gear should cost
// around 5k to 10k") — a fully-broken (0 durability) Normal-quality item's
// repair cost climbs geometrically from REPAIR_COST_AT_LEVEL_1 to
// REPAIR_COST_AT_LEVEL_130 (same log-scale-interpolation style
// useProgressionStore's own EXP_CURVE_ANCHORS already uses), scaled by
// QUALITY_STAT_MULTIPLIERS (consistent with sell-price scaling) and then by
// how much durability is actually missing — a lightly-worn item costs
// proportionally less than a fully-broken one, not the same flat price
// regardless of damage (the old, pre-rescale behavior).
// Halved across the board 2026-08-20 (requested by the user) — halving both
// curve endpoints keeps the same geometric shape/pacing while scaling every
// resulting cost by exactly 0.5.
const REPAIR_COST_AT_LEVEL_1 = 3750
const REPAIR_COST_AT_LEVEL_130 = 50000

export function computeRepairCost(requiredLevel: number, qualityTier: string, currentDurability: number, maxDurability: number): number {
  if (maxDurability <= 0) return 0
  const t = Math.max(0, Math.min(1, (requiredLevel - 1) / 129))
  const fullBreakCost = REPAIR_COST_AT_LEVEL_1 * (REPAIR_COST_AT_LEVEL_130 / REPAIR_COST_AT_LEVEL_1) ** t
  const missingFraction = Math.max(0, Math.min(1, (maxDurability - currentDurability) / maxDurability))
  return Math.round(fullBreakCost * (QUALITY_STAT_MULTIPLIERS[qualityTier] ?? 1) * missingFraction)
}

// Bug fix (2026-07-31): every call site used to pass the template's raw,
// unscaled base_stats directly, so an item's displayed stats never changed
// with quality tier even though computeEquipmentBonus already applied
// QUALITY_STAT_MULTIPLIERS correctly for actual combat math — an Ascended
// item was genuinely stronger in battle, it just displayed identically to a
// Normal one everywhere (Inventory detail card, Equipment paper doll, the
// universal tooltip). qualityTier is now required so every caller scales
// consistently with what combat actually uses.
// Attack stats now roll a min/max range in actual combat (see
// combatResolver.ts's rollDamageInRange) rather than dealing a flat number —
// shown here as a range too, so gear tooltips honestly reflect what a hit
// with this item actually looks like. Other stats (defense, dodge) aren't
// ranged and keep showing a flat "+N".
const RANGED_STAT_KEYS = ['physical_attack', 'magic_attack']

export function formatBaseStats(baseStats: Record<string, number>, qualityTier: string, itemFamily?: string | null): string {
  return Object.entries(baseStats)
    .map(([key]) => {
      const value = scaledStat(baseStats, key, qualityTier, itemFamily)
      if (RANGED_STAT_KEYS.includes(key)) {
        const { min, max } = damageRangeFromMidpoint(value ?? 0)
        return `${min}-${max} ${key.replace(/_/g, ' ')}`
      }
      return `+${value} ${key.replace(/_/g, ' ')}`
    })
    .join(', ')
}

// Structured counterpart to formatBaseStats above, used only by
// buildGearTooltip (the plain Inventory/Equipment detail-card displays keep
// using formatBaseStats' flat string) — same per-key formatting, but keeps
// each entry separate so Physical Defense/Dodge can render white while
// everything else keeps the tooltip's default stat-block blue. These lines
// now live inside buildGearTooltip's `lines` (2026-08-13 tooltip reorder —
// see that function), not the bordered `stats` block, so every entry gets an
// explicit color rather than relying on either block's own default. Ordered
// white-first, then blue — a fixed, deliberate order rather than whatever
// key order base_stats happens to store, per the user's "white stats after
// Class before Sockets, blue stats after white" layout.
export function buildStatTooltipLines(baseStats: Record<string, number>, qualityTier: string, itemFamily?: string | null): TooltipLine[] {
  const toLine = (key: string): TooltipLine => {
    const value = scaledStat(baseStats, key, qualityTier, itemFamily)
    const text = RANGED_STAT_KEYS.includes(key)
      ? (() => {
          const { min, max } = damageRangeFromMidpoint(value ?? 0)
          return `${min}-${max} ${key.replace(/_/g, ' ')}`
        })()
      : `+${value} ${key.replace(/_/g, ' ')}`
    return { text, color: WHITE_STAT_KEYS.includes(key) ? TOOLTIP_WHITE : DEFAULT_STAT_COLOR }
  }

  const keys = Object.keys(baseStats)
  const whiteKeys = keys.filter((key) => WHITE_STAT_KEYS.includes(key))
  const blueKeys = keys.filter((key) => !WHITE_STAT_KEYS.includes(key))
  return [...whiteKeys.map(toLine), ...blueKeys.map(toLine)]
}

// Underlying stored quality_tier values were originally 'normal'/'refined'/
// 'unique'/'elite'/'super' (a display-only rename, 2026-08-01/02, mapped them
// to these labels without any schema/migration/SQL change) — since fully
// renamed at the storage layer too (2026-08-03, see
// supabase/migrations/20260803110000_rename_quality_tiers.sql), so the
// stored values now match these labels directly (just lowercase, one word
// each). This lookup table stays for the capitalization/display formatting,
// not because the underlying key differs anymore. Confirmed tier names/
// colors (replaces the earlier placeholder gray->blue->purple->orange->red
// gradient with a real, designed palette).
const QUALITY_LABELS: Record<string, string> = {
  normal: 'Normal',
  tempered: 'Tempered',
  infused: 'Infused',
  radiant: 'Radiant',
  ascended: 'Ascended',
}

// Recalibrated (2026-08-02, supersedes the earlier White/Warm-bronze/Silver/
// Baby-blue/Orange set) — the user found that set too washed-out/pastel to
// read as a clear escalating ladder against this game's dark UI. Back to a
// punchier light blue → dark blue → purple → red progression (closer to the
// original pre-White/bronze/silver/baby-blue/orange placeholder gradient
// mentioned in CLAUDE.md's Gear system section). Normal stays plain white —
// nobody flagged that one, only the four upgrade tiers above it needed to
// stand out more.
export const QUALITY_COLORS: Record<string, string> = {
  normal: '#FFFFFF',
  tempered: '#4FC3F7',
  infused: '#2E5EAA',
  radiant: '#A855F7',
  ascended: '#EF4444',
}

export function getQualityColor(qualityTier: string): string {
  return QUALITY_COLORS[qualityTier] ?? QUALITY_COLORS.normal
}

// Matches the locked placeholder slot icons already used in EquipmentPanel's
// paper doll, so a real item and its slot's empty-state icon read as the same
// thing. Previously every gear tile everywhere hardcoded the sword emoji
// regardless of slot_type — a coat or hat displayed with a sword icon, a
// separate (cosmetic) bug from the equip-into-weapon-slot bug fixed in 1.28.1.
const SLOT_ICONS: Record<string, string> = {
  weapon: '🗡️',
  hat: '🪖',
  coat: '🥋',
  necklace: '📿',
  ring: '💍',
  boots: '👢',
  quiver: '🏹',
  'money-bag': '💰',
  'gem-bag': '🎁',
  pickaxe: '⛏️',
  material: '🪨',
  'promotion-material': '💠',
}

export function getItemIcon(slotType: string | undefined): string {
  return (slotType && SLOT_ICONS[slotType]) || '🗡️'
}

// Real per-item art, started one weapon at a time (2026-08-03) — same
// incremental-rollout precedent as the Zones section's monster portraits
// (public/monsters/, EnemyTypeDef.portraitUrl). Keyed by item_templates.name
// rather than a DB column: unlike monsters (a static ENEMY_TYPES array in
// zoneData.ts that already had room for a portraitUrl field), gear has no
// static per-template TS definition to extend — item_templates is entirely
// DB-driven — so adding a nullable icon_url column would mean a schema
// migration (and another manual SQL-editor step) for what's purely cosmetic.
// A plain client-side name lookup avoids that entirely. Every call site that
// already computes `icon: getItemIcon(template?.slot_type)` should also
// compute `iconSrc: getGearIconSrc(template?.name)` alongside it — InventorySlot
// (and anywhere else that mirrors its `iconSrc`-over-`icon` priority) already
// falls back to the emoji `icon` whenever this returns undefined, so adding a
// new mapping entry here is the only step needed to roll out the next piece
// of art — no other file needs touching.
const ITEM_ICON_OVERRIDES: Record<string, string> = {
  'Umbrite Ore': `${import.meta.env.BASE_URL}item-icons/umbrite-ore.webp`,
  'Jade Shard': `${import.meta.env.BASE_URL}item-icons/jade-shard.webp`,
  'Lunar Chest': `${import.meta.env.BASE_URL}item-icons/lunar-chest.webp`,
  'Sapling Bow': `${import.meta.env.BASE_URL}item-icons/sapling-bow.webp`,
  "Ranger's Bow": `${import.meta.env.BASE_URL}item-icons/rangers-bow.webp`,
  'Lucky Bow': `${import.meta.env.BASE_URL}item-icons/lucky-bow.webp`,
  'Thornwood Bow': `${import.meta.env.BASE_URL}item-icons/thornwood-bow.webp`,
  'Evergreen Bow': `${import.meta.env.BASE_URL}item-icons/evergreen-bow.webp`,
  'Stonewood Bow': `${import.meta.env.BASE_URL}item-icons/stonewood-bow.webp`,
  'Gale Bow': `${import.meta.env.BASE_URL}item-icons/gale-bow.webp`,
  'Vermil Bow': `${import.meta.env.BASE_URL}item-icons/vermil-bow.webp`,
  "Ram's Horn Bow": `${import.meta.env.BASE_URL}item-icons/rams-horn-bow.webp`,
  'Sovereign Bow': `${import.meta.env.BASE_URL}item-icons/sovereign-bow.webp`,
  'Farreach Bow': `${import.meta.env.BASE_URL}item-icons/farreach-bow.webp`,
  "Drover's Bow": `${import.meta.env.BASE_URL}item-icons/drovers-bow.webp`,
  'Forgesteel Bow': `${import.meta.env.BASE_URL}item-icons/forgesteel-bow.webp`,
  'Windwing Bow': `${import.meta.env.BASE_URL}item-icons/windwing-bow.webp`,
  'Stripeback Bow': `${import.meta.env.BASE_URL}item-icons/stripeback-bow.webp`,
  'Heartwood Bow': `${import.meta.env.BASE_URL}item-icons/heartwood-bow.webp`,
  'Runed Bow': `${import.meta.env.BASE_URL}item-icons/runed-bow.webp`,
  'Starfall Bow': `${import.meta.env.BASE_URL}item-icons/starfall-bow.webp`,
  'Nightglow Bow': `${import.meta.env.BASE_URL}item-icons/nightglow-bow.webp`,
  'Rosemark Bow': `${import.meta.env.BASE_URL}item-icons/rosemark-bow.webp`,
  'Wyrmstring Bow': `${import.meta.env.BASE_URL}item-icons/wyrmstring-bow.webp`,
  'Timeworn Bow': `${import.meta.env.BASE_URL}item-icons/timeworn-bow.webp`,
  'Skyborne Bow': `${import.meta.env.BASE_URL}item-icons/skyborne-bow.webp`,
  'Sorcerous Bow': `${import.meta.env.BASE_URL}item-icons/sorcerous-bow.webp`,
  'Emberwing Bow': `${import.meta.env.BASE_URL}item-icons/emberwing-bow.webp`,
  'Voidcaller Bow': `${import.meta.env.BASE_URL}item-icons/voidcaller-bow.webp`,
  'Mole Hat': `${import.meta.env.BASE_URL}item-icons/mole-hat.webp`,
  'Lynx Hat': `${import.meta.env.BASE_URL}item-icons/lynx-hat.webp`,
  'Coyote Hat': `${import.meta.env.BASE_URL}item-icons/coyote-hat.webp`,
  'Ocelot Hat': `${import.meta.env.BASE_URL}item-icons/ocelot-hat.webp`,
  'Simian Hat': `${import.meta.env.BASE_URL}item-icons/simian-hat.webp`,
  'Ferret Hat': `${import.meta.env.BASE_URL}item-icons/ferret-hat.webp`,
  'Stag Hat': `${import.meta.env.BASE_URL}item-icons/stag-hat.webp`,
  'Bullhide Hat': `${import.meta.env.BASE_URL}item-icons/bullhide-hat.webp`,
  'Talon Hat': `${import.meta.env.BASE_URL}item-icons/talon-hat.webp`,
  'Finhead Hat': `${import.meta.env.BASE_URL}item-icons/finhead-hat.webp`,
  'Cinderplume Hat': `${import.meta.env.BASE_URL}item-icons/cinderplume-hat.webp`,
  'Fawnhide Coat': `${import.meta.env.BASE_URL}item-icons/fawnhide-coat.webp`,
  'Vixen Coat': `${import.meta.env.BASE_URL}item-icons/vixen-coat.webp`,
  'Timberwolf Coat': `${import.meta.env.BASE_URL}item-icons/timberwolf-coat.webp`,
  'Dappled Coat': `${import.meta.env.BASE_URL}item-icons/dappled-coat.webp`,
  'Silverback Coat': `${import.meta.env.BASE_URL}item-icons/silverback-coat.webp`,
  'Quilted Coat': `${import.meta.env.BASE_URL}item-icons/quilted-coat.webp`,
  'Finscale Coat': `${import.meta.env.BASE_URL}item-icons/finscale-coat.webp`,
  'Hidebound Coat': `${import.meta.env.BASE_URL}item-icons/hidebound-coat.webp`,
  'Skyfeather Coat': `${import.meta.env.BASE_URL}item-icons/skyfeather-coat.webp`,
  'Wyrmhide Coat': `${import.meta.env.BASE_URL}item-icons/wyrmhide-coat.webp`,
  'Emberplate Coat': `${import.meta.env.BASE_URL}item-icons/emberplate-coat.webp`,
  'Twine Necklace': `${import.meta.env.BASE_URL}item-icons/twine-necklace.webp`,
  'Wisp Necklace': `${import.meta.env.BASE_URL}item-icons/wisp-necklace.webp`,
  'Locket Necklace': `${import.meta.env.BASE_URL}item-icons/locket-necklace.webp`,
  'Emerald Necklace': `${import.meta.env.BASE_URL}item-icons/emerald-necklace.webp`,
  'Quartz Necklace': `${import.meta.env.BASE_URL}item-icons/quartz-necklace.webp`,
  'Sunmetal Necklace': `${import.meta.env.BASE_URL}item-icons/sunmetal-necklace.webp`,
  'Whitesteel Necklace': `${import.meta.env.BASE_URL}item-icons/whitesteel-necklace.webp`,
  'Obsidian Necklace': `${import.meta.env.BASE_URL}item-icons/obsidian-necklace.webp`,
  "Serpent's Necklace": `${import.meta.env.BASE_URL}item-icons/serpents-necklace.webp`,
  'Reliquary Necklace': `${import.meta.env.BASE_URL}item-icons/reliquary-necklace.webp`,
  'Umbral Necklace': `${import.meta.env.BASE_URL}item-icons/umbral-necklace.webp`,
  'Reverie Necklace': `${import.meta.env.BASE_URL}item-icons/reverie-necklace.webp`,
  'Cyclone Necklace': `${import.meta.env.BASE_URL}item-icons/cyclone-necklace.webp`,
  'Tin Ring': `${import.meta.env.BASE_URL}item-icons/tin-ring.webp`,
  'Brass Ring': `${import.meta.env.BASE_URL}item-icons/brass-ring.webp`,
  'Pewter Ring': `${import.meta.env.BASE_URL}item-icons/pewter-ring.webp`,
  'Gilded Ring': `${import.meta.env.BASE_URL}item-icons/gilded-ring.webp`,
  'Violet Ring': `${import.meta.env.BASE_URL}item-icons/violet-ring.webp`,
  'Bonewhite Ring': `${import.meta.env.BASE_URL}item-icons/bonewhite-ring.webp`,
  'Verdant Ring': `${import.meta.env.BASE_URL}item-icons/verdant-ring.webp`,
  'Opal Ring': `${import.meta.env.BASE_URL}item-icons/opal-ring.webp`,
  'Banded Ring': `${import.meta.env.BASE_URL}item-icons/banded-ring.webp`,
  'Glass Ring': `${import.meta.env.BASE_URL}item-icons/glass-ring.webp`,
  'Facet Ring': `${import.meta.env.BASE_URL}item-icons/facet-ring.webp`,
  'Wyrmscale Ring': `${import.meta.env.BASE_URL}item-icons/wyrmscale-ring.webp`,
  'Weeping Ring': `${import.meta.env.BASE_URL}item-icons/weeping-ring.webp`,
  'Oathbound Ring': `${import.meta.env.BASE_URL}item-icons/oathbound-ring.webp`,
  'Stormcaller Ring': `${import.meta.env.BASE_URL}item-icons/stormcaller-ring.webp`,
  'Rawhide Boots': `${import.meta.env.BASE_URL}item-icons/rawhide-boots.webp`,
  'Fawnskin Boots': `${import.meta.env.BASE_URL}item-icons/fawnskin-boots.webp`,
  'Padded Boots': `${import.meta.env.BASE_URL}item-icons/padded-boots.webp`,
  'Hawkstep Boots': `${import.meta.env.BASE_URL}item-icons/hawkstep-boots.webp`,
  'Featherstep Boots': `${import.meta.env.BASE_URL}item-icons/featherstep-boots.webp`,
  'Scalehide Boots': `${import.meta.env.BASE_URL}item-icons/scalehide-boots.webp`,
  'Viperskin Boots': `${import.meta.env.BASE_URL}item-icons/viperskin-boots.webp`,
  'Prowler Boots': `${import.meta.env.BASE_URL}item-icons/prowler-boots.webp`,
  'Spotted Boots': `${import.meta.env.BASE_URL}item-icons/spotted-boots.webp`,
  'Direbeast Boots': `${import.meta.env.BASE_URL}item-icons/direbeast-boots.webp`,
  'Nimble Boots': `${import.meta.env.BASE_URL}item-icons/nimble-boots.webp`,
  'Charmed Boots': `${import.meta.env.BASE_URL}item-icons/charmed-boots.webp`,
  'Liberty Boots': `${import.meta.env.BASE_URL}item-icons/liberty-boots.webp`,
  'Frostbite Boots': `${import.meta.env.BASE_URL}item-icons/frostbite-boots.webp`,
  "Hunter's Quiver": `${import.meta.env.BASE_URL}item-icons/quiver.webp`,
  // Money Bag classes 1-10 (2026-08-13) — escalating sack art from worn/
  // patched burlap up through a bejeweled velvet pouch and finally a
  // crowned black-velvet purse, matching the Class 1-10 gold ramp (see
  // forgeCosts.ts's MONEY_BAG_GOLD_BY_CLASS). Full set now, no emoji
  // fallback needed for any class.
  'Class 1 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-1.webp`,
  'Class 2 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-2.webp`,
  'Class 3 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-3.webp`,
  'Class 4 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-4.webp`,
  'Class 5 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-5.webp`,
  'Class 6 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-6.webp`,
  'Class 7 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-7.webp`,
  'Class 8 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-8.webp`,
  'Class 9 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-9.webp`,
  'Class 10 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-10.webp`,
  // Random Gem Bag (2026-08-14) — user-supplied black-velvet crowned pouch
  // art, same trim/pad/resize-to-160 pipeline as every other icon here.
  'Random Gem Bag': `${import.meta.env.BASE_URL}item-icons/gem-bag.webp`,
  // Club (Twin-soul/Juggernaut, still class-locked — see CLAUDE.accounts-and-classes.md).
  // Same 5 names cover the club-twinsoul, club-juggernaut, and club-offhand-twinsoul
  // item_family chains since this map keys off name, not family.
  'Knot Club': `${import.meta.env.BASE_URL}item-icons/knot-club.webp`,
  'Rustcut Club': `${import.meta.env.BASE_URL}item-icons/rustcut-club.webp`,
  'Rivet Club': `${import.meta.env.BASE_URL}item-icons/stub-club.webp`,
  'Cudgel Club': `${import.meta.env.BASE_URL}item-icons/cudgel-club.webp`,
  'Hardwood Club': `${import.meta.env.BASE_URL}item-icons/hardwood-club.webp`,
  'Mastiff Club': `${import.meta.env.BASE_URL}item-icons/mastiff-club.webp`,
  'Cane Club': `${import.meta.env.BASE_URL}item-icons/cane-club.webp`,
  'Ferrule Club': `${import.meta.env.BASE_URL}item-icons/anvil-club.webp`,
  'Legion Club': `${import.meta.env.BASE_URL}item-icons/legion-club.webp`,
  'Warworn Club': `${import.meta.env.BASE_URL}item-icons/siege-club.webp`,
  'Skirmish Club': `${import.meta.env.BASE_URL}item-icons/skirmish-club.webp`,
  'Fang Club': `${import.meta.env.BASE_URL}item-icons/fang-club.webp`,
  'Stinger Club': `${import.meta.env.BASE_URL}item-icons/stinger-club.webp`,
  'Copper Club': `${import.meta.env.BASE_URL}item-icons/copper-club.webp`,
  'Steel Club': `${import.meta.env.BASE_URL}item-icons/steel-club.webp`,
  'Claw Club': `${import.meta.env.BASE_URL}item-icons/claw-club.webp`,
  'Panther Club': `${import.meta.env.BASE_URL}item-icons/panther-club.webp`,
  'Bone Club': `${import.meta.env.BASE_URL}item-icons/bone-club.webp`,
  'Fin Club': `${import.meta.env.BASE_URL}item-icons/fin-club.webp`,
  'Thunderhead Club': `${import.meta.env.BASE_URL}item-icons/serpent-club.webp`,
  'Voltaic Club': `${import.meta.env.BASE_URL}item-icons/wyrm-club.webp`,
  'Galeforge Club': `${import.meta.env.BASE_URL}item-icons/triumph-club.webp`,
  'Maelstrom Club': `${import.meta.env.BASE_URL}item-icons/titan-club.webp`,
  'Storm Club': `${import.meta.env.BASE_URL}item-icons/storm-club.webp`,
  'Squall Club': `${import.meta.env.BASE_URL}item-icons/ruin-club.webp`,
  'Sovereign Club': `${import.meta.env.BASE_URL}item-icons/crown-club.webp`,
  // Sword (Twin-soul/Juggernaut). Same 5 names cover the longsword-twinsoul,
  // longsword-juggernaut, and longsword-offhand-twinsoul item_family chains.
  // All 26 tiers have art.
  'Squire Sword': `${import.meta.env.BASE_URL}item-icons/squire-sword.webp`,
  'Coil Sword': `${import.meta.env.BASE_URL}item-icons/coil-sword.webp`,
  'Shade Sword': `${import.meta.env.BASE_URL}item-icons/shade-sword.webp`,
  'Gleam Sword': `${import.meta.env.BASE_URL}item-icons/gleam-sword.webp`,
  'Quartz Sword': `${import.meta.env.BASE_URL}item-icons/quartz-sword.webp`,
  'Cinder Sword': `${import.meta.env.BASE_URL}item-icons/cinder-sword.webp`,
  'Obsidian Sword': `${import.meta.env.BASE_URL}item-icons/obsidian-sword.webp`,
  'Ridge Sword': `${import.meta.env.BASE_URL}item-icons/ridge-sword.webp`,
  'Calm Sword': `${import.meta.env.BASE_URL}item-icons/calm-sword.webp`,
  'Tusk Sword': `${import.meta.env.BASE_URL}item-icons/tusk-sword.webp`,
  'Glass Sword': `${import.meta.env.BASE_URL}item-icons/glass-sword.webp`,
  'Flamberge': `${import.meta.env.BASE_URL}item-icons/flamberge.webp`,
  'Rover Sword': `${import.meta.env.BASE_URL}item-icons/rover-sword.webp`,
  'Marlin Sword': `${import.meta.env.BASE_URL}item-icons/marlin-sword.webp`,
  'Radiant Sword': `${import.meta.env.BASE_URL}item-icons/radiant-sword.webp`,
  'Dual Sword': `${import.meta.env.BASE_URL}item-icons/dual-sword.webp`,
  'Prism Sword': `${import.meta.env.BASE_URL}item-icons/prism-sword.webp`,
  'Great Sword': `${import.meta.env.BASE_URL}item-icons/great-sword.webp`,
  'Oath Sword': `${import.meta.env.BASE_URL}item-icons/wyrm-sword.webp`,
  'Creed Sword': `${import.meta.env.BASE_URL}item-icons/vow-sword.webp`,
  'Sunray Sword': `${import.meta.env.BASE_URL}item-icons/soar-sword.webp`,
  'Lucent Sword': `${import.meta.env.BASE_URL}item-icons/clear-sword.webp`,
  'Umbra Sword': `${import.meta.env.BASE_URL}item-icons/abyss-sword.webp`,
  'Regal Sword': `${import.meta.env.BASE_URL}item-icons/regal-sword.webp`,
  'Ruin Sword': `${import.meta.env.BASE_URL}item-icons/ruin-sword.webp`,
  'Crown Sword': `${import.meta.env.BASE_URL}item-icons/crown-sword.webp`,
  // Blade (Twin-soul/Juggernaut). Same names cover the blade-twinsoul,
  // blade-juggernaut, and blade-offhand-twinsoul item_family chains. Blade is
  // the only weapon category with a sub-5 starter tier (Fortune Blade at
  // level 1). All 27 tiers have art.
  'Fortune Blade': `${import.meta.env.BASE_URL}item-icons/fortune-blade.webp`,
  'Bronze Blade': `${import.meta.env.BASE_URL}item-icons/bronze-blade.webp`,
  'Vine Blade': `${import.meta.env.BASE_URL}item-icons/vine-blade.webp`,
  'Fiend Blade': `${import.meta.env.BASE_URL}item-icons/fiend-blade.webp`,
  'Glint Blade': `${import.meta.env.BASE_URL}item-icons/glint-blade.webp`,
  'Scimitar': `${import.meta.env.BASE_URL}item-icons/scimitar.webp`,
  'Wide Blade': `${import.meta.env.BASE_URL}item-icons/wide-blade.webp`,
  'Warped Blade': `${import.meta.env.BASE_URL}item-icons/warped-blade.webp`,
  'Saber': `${import.meta.env.BASE_URL}item-icons/saber.webp`,
  'Garnet Blade': `${import.meta.env.BASE_URL}item-icons/garnet-blade.webp`,
  'Crescent Blade': `${import.meta.env.BASE_URL}item-icons/crescent-blade.webp`,
  'Chill Blade': `${import.meta.env.BASE_URL}item-icons/chill-blade.webp`,
  'Khopesh': `${import.meta.env.BASE_URL}item-icons/khopesh.webp`,
  'Stag Blade': `${import.meta.env.BASE_URL}item-icons/stag-blade.webp`,
  'Wren Blade': `${import.meta.env.BASE_URL}item-icons/wren-blade.webp`,
  'Wyvern Blade': `${import.meta.env.BASE_URL}item-icons/wyvern-blade.webp`,
  'Hefty Blade': `${import.meta.env.BASE_URL}item-icons/hefty-blade.webp`,
  'Kilij': `${import.meta.env.BASE_URL}item-icons/kilij.webp`,
  'Divine Blade': `${import.meta.env.BASE_URL}item-icons/divine-blade.webp`,
  'Keen Blade': `${import.meta.env.BASE_URL}item-icons/keen-blade.webp`,
  'Prism Blade': `${import.meta.env.BASE_URL}item-icons/prism-blade.webp`,
  'Solar Blade': `${import.meta.env.BASE_URL}item-icons/solar-blade.webp`,
  'Legend Blade': `${import.meta.env.BASE_URL}item-icons/legend-blade.webp`,
  'Triumph Blade': `${import.meta.env.BASE_URL}item-icons/triumph-blade.webp`,
  'Rime Blade': `${import.meta.env.BASE_URL}item-icons/rime-blade.webp`,
  'Blaze Blade': `${import.meta.env.BASE_URL}item-icons/blaze-blade.webp`,
  'Grave Blade': `${import.meta.env.BASE_URL}item-icons/grave-blade.webp`,
  // Wand (Juggernaut's own two-hander, keyed 'greatmaul'; a heavy reflavor of
  // the source data's caster Wand, not a magic item). All 26 tiers have art.
  'Pebble Wand': `${import.meta.env.BASE_URL}item-icons/pebble-wand.webp`,
  'Stone Wand': `${import.meta.env.BASE_URL}item-icons/stone-wand.webp`,
  'Heartwood Wand': `${import.meta.env.BASE_URL}item-icons/heartwood-wand.webp`,
  'Clash Wand': `${import.meta.env.BASE_URL}item-icons/clash-wand.webp`,
  'Despot Wand': `${import.meta.env.BASE_URL}item-icons/despot-wand.webp`,
  'Temple Wand': `${import.meta.env.BASE_URL}item-icons/temple-wand.webp`,
  'Legion Wand': `${import.meta.env.BASE_URL}item-icons/legion-wand.webp`,
  'Lion Wand': `${import.meta.env.BASE_URL}item-icons/lion-wand.webp`,
  'Epoch Wand': `${import.meta.env.BASE_URL}item-icons/epoch-wand.webp`,
  'Sacred Wand': `${import.meta.env.BASE_URL}item-icons/sacred-wand.webp`,
  'Bloom Wand': `${import.meta.env.BASE_URL}item-icons/bloom-wand.webp`,
  'Strife Wand': `${import.meta.env.BASE_URL}item-icons/strife-wand.webp`,
  'Truce Wand': `${import.meta.env.BASE_URL}item-icons/truce-wand.webp`,
  'Forge Wand': `${import.meta.env.BASE_URL}item-icons/forge-wand.webp`,
  'Alloy Wand': `${import.meta.env.BASE_URL}item-icons/alloy-wand.webp`,
  'Summit Wand': `${import.meta.env.BASE_URL}item-icons/summit-wand.webp`,
  'Wolf Wand': `${import.meta.env.BASE_URL}item-icons/wolf-wand.webp`,
  'Purge Wand': `${import.meta.env.BASE_URL}item-icons/purge-wand.webp`,
  'Stalwart Wand': `${import.meta.env.BASE_URL}item-icons/stalwart-wand.webp`,
  'Bronze Wand': `${import.meta.env.BASE_URL}item-icons/bronze-wand.webp`,
  'Platinum Wand': `${import.meta.env.BASE_URL}item-icons/platinum-wand.webp`,
  'Colossus Wand': `${import.meta.env.BASE_URL}item-icons/drake-wand.webp`,
  'Cairn Wand': `${import.meta.env.BASE_URL}item-icons/victory-wand.webp`,
  'Warlord Wand': `${import.meta.env.BASE_URL}item-icons/warlord-wand.webp`,
  'Overlord Wand': `${import.meta.env.BASE_URL}item-icons/overlord-wand.webp`,
  'Monarch Wand': `${import.meta.env.BASE_URL}item-icons/crown-wand.webp`,
  // Backsword (Wuxia exclusive). All 27 tiers have art, including the
  // Level 1 Lucky Backsword starter (mirrors Blade's own Fortune Blade).
  'Lucky Backsword': `${import.meta.env.BASE_URL}item-icons/lucky-backsword.webp`,
  'Plum Backsword': `${import.meta.env.BASE_URL}item-icons/plum-backsword.webp`,
  'Charm Backsword': `${import.meta.env.BASE_URL}item-icons/charm-backsword.webp`,
  'Honest Backsword': `${import.meta.env.BASE_URL}item-icons/honest-backsword.webp`,
  'Willow Backsword': `${import.meta.env.BASE_URL}item-icons/willow-backsword.webp`,
  'Moonlit Backsword': `${import.meta.env.BASE_URL}item-icons/moonlit-backsword.webp`,
  'Petal Backsword': `${import.meta.env.BASE_URL}item-icons/petal-backsword.webp`,
  'Silk Backsword': `${import.meta.env.BASE_URL}item-icons/silk-backsword.webp`,
  'Twilight Backsword': `${import.meta.env.BASE_URL}item-icons/twilight-backsword.webp`,
  'Steel Backsword': `${import.meta.env.BASE_URL}item-icons/steel-backsword.webp`,
  'Bronze Backsword': `${import.meta.env.BASE_URL}item-icons/bronze-backsword.webp`,
  'Amber Backsword': `${import.meta.env.BASE_URL}item-icons/amber-backsword.webp`,
  'Jade Backsword': `${import.meta.env.BASE_URL}item-icons/jade-backsword.webp`,
  'Comet Backsword': `${import.meta.env.BASE_URL}item-icons/comet-backsword.webp`,
  'Noble Backsword': `${import.meta.env.BASE_URL}item-icons/noble-backsword.webp`,
  'Glow Backsword': `${import.meta.env.BASE_URL}item-icons/glow-backsword.webp`,
  'Bloom Backsword': `${import.meta.env.BASE_URL}item-icons/bloom-backsword.webp`,
  'Solar Backsword': `${import.meta.env.BASE_URL}item-icons/solar-backsword.webp`,
  'Conflict Backsword': `${import.meta.env.BASE_URL}item-icons/conflict-backsword.webp`,
  'Origin Backsword': `${import.meta.env.BASE_URL}item-icons/origin-backsword.webp`,
  'Mist Backsword': `${import.meta.env.BASE_URL}item-icons/mist-backsword.webp`,
  'Zephyr Backsword': `${import.meta.env.BASE_URL}item-icons/zephyr-backsword.webp`,
  'Thunder Backsword': `${import.meta.env.BASE_URL}item-icons/thunder-backsword.webp`,
  'Conquest Backsword': `${import.meta.env.BASE_URL}item-icons/conquest-backsword.webp`,
  'Astral Backsword': `${import.meta.env.BASE_URL}item-icons/astral-backsword.webp`,
  'Celestial Backsword': `${import.meta.env.BASE_URL}item-icons/celestial-backsword.webp`,
  'Eternity Backsword': `${import.meta.env.BASE_URL}item-icons/eternity-backsword.webp`,
  // Bracelet (Wuxia exclusive — ring slot, displayed as two stacked bangles).
  // All 14 tiers have art.
  'Bead Bracelet': `${import.meta.env.BASE_URL}item-icons/bead-bracelet.webp`,
  'Jasper Bracelet': `${import.meta.env.BASE_URL}item-icons/jasper-bracelet.webp`,
  'Coral Bracelet': `${import.meta.env.BASE_URL}item-icons/coral-bracelet.webp`,
  'Onyx Bracelet': `${import.meta.env.BASE_URL}item-icons/onyx-bracelet.webp`,
  'Amberwood Bracelet': `${import.meta.env.BASE_URL}item-icons/amberwood-bracelet.webp`,
  'Serpentine Bracelet': `${import.meta.env.BASE_URL}item-icons/serpentine-bracelet.webp`,
  'Moonstone Bracelet': `${import.meta.env.BASE_URL}item-icons/moonstone-bracelet.webp`,
  'Garnet Bracelet': `${import.meta.env.BASE_URL}item-icons/garnet-bracelet.webp`,
  'Crystal Bracelet': `${import.meta.env.BASE_URL}item-icons/crystal-bracelet.webp`,
  'Forgedwire Bracelet': `${import.meta.env.BASE_URL}item-icons/forgedwire-bracelet.webp`,
  'Filigree Bracelet': `${import.meta.env.BASE_URL}item-icons/filigree-bracelet.webp`,
  'Beryl Bracelet': `${import.meta.env.BASE_URL}item-icons/beryl-bracelet.webp`,
  'Luminous Bracelet': `${import.meta.env.BASE_URL}item-icons/radiant-bracelet.webp`,
  'Prismatic Bracelet': `${import.meta.env.BASE_URL}item-icons/prismatic-bracelet.webp`,
  // Cap (Wuxia exclusive — hat slot). 11 of 13 tiers have art; stopping here
  // per user 2026-08-25 — Moonbound Cap (121) and Heavensent Cap (126) stay
  // unprocessed/emoji-fallback indefinitely, same as any other not-yet-
  // reachable Wuxia tier (Wuxia is still class-locked, Hunter-only).
  'Reed Cap': `${import.meta.env.BASE_URL}item-icons/reed-cap.webp`,
  'Silk Cap': `${import.meta.env.BASE_URL}item-icons/silk-cap.webp`,
  'Dawn Cap': `${import.meta.env.BASE_URL}item-icons/dawn-cap.webp`,
  'Crane Cap': `${import.meta.env.BASE_URL}item-icons/crane-cap.webp`,
  'Weave Cap': `${import.meta.env.BASE_URL}item-icons/weave-cap.webp`,
  'Frostpetal Cap': `${import.meta.env.BASE_URL}item-icons/frostpetal-cap.webp`,
  'Moonpetal Cap': `${import.meta.env.BASE_URL}item-icons/moonpetal-cap.webp`,
  'Cloudsilk Cap': `${import.meta.env.BASE_URL}item-icons/cloudsilk-cap.webp`,
  'Jadeleaf Cap': `${import.meta.env.BASE_URL}item-icons/jadeleaf-cap.webp`,
  'Snowveil Cap': `${import.meta.env.BASE_URL}item-icons/snowveil-cap.webp`,
  'Skysworn Cap': `${import.meta.env.BASE_URL}item-icons/skysworn-cap.webp`,
  // Robe (Wuxia exclusive — coat slot). All 11 tiers have art.
  'Hemp Robe': `${import.meta.env.BASE_URL}item-icons/hemp-robe.webp`,
  'Sable Robe': `${import.meta.env.BASE_URL}item-icons/sable-robe.webp`,
  'Linen Robe': `${import.meta.env.BASE_URL}item-icons/linen-robe.webp`,
  'Gossamer Robe': `${import.meta.env.BASE_URL}item-icons/gossamer-robe.webp`,
  'Saffron Robe': `${import.meta.env.BASE_URL}item-icons/saffron-robe.webp`,
  'Cloudspun Robe': `${import.meta.env.BASE_URL}item-icons/cloudspun-robe.webp`,
  'Jadefall Robe': `${import.meta.env.BASE_URL}item-icons/jadefall-robe.webp`,
  'Duskbound Robe': `${import.meta.env.BASE_URL}item-icons/duskbound-robe.webp`,
  'Phoenixdown Robe': `${import.meta.env.BASE_URL}item-icons/phoenixdown-robe.webp`,
  'Ashweave Robe': `${import.meta.env.BASE_URL}item-icons/ashweave-robe.webp`,
  'Silkbound Robe': `${import.meta.env.BASE_URL}item-icons/silkbound-robe.webp`,
  // Bag (Wuxia exclusive — necklace slot, ornamental hanging pillow charm).
  // All 13 tiers have art.
  'Cotton Bag': `${import.meta.env.BASE_URL}item-icons/cotton-bag.webp`,
  'Woven Bag': `${import.meta.env.BASE_URL}item-icons/woven-bag.webp`,
  'Tassel Bag': `${import.meta.env.BASE_URL}item-icons/tassel-bag.webp`,
  'Cord Bag': `${import.meta.env.BASE_URL}item-icons/cord-bag.webp`,
  'Pouch Bag': `${import.meta.env.BASE_URL}item-icons/pouch-bag.webp`,
  'Cloth Bag': `${import.meta.env.BASE_URL}item-icons/cloth-bag.webp`,
  'Rope Bag': `${import.meta.env.BASE_URL}item-icons/rope-bag.webp`,
  'Satchel Bag': `${import.meta.env.BASE_URL}item-icons/satchel-bag.webp`,
  'Plume Bag': `${import.meta.env.BASE_URL}item-icons/plume-bag.webp`,
  'Charm Bag': `${import.meta.env.BASE_URL}item-icons/charm-bag.webp`,
  'Silksworn Bag': `${import.meta.env.BASE_URL}item-icons/silksworn-bag.webp`,
  'Moonlit Bag': `${import.meta.env.BASE_URL}item-icons/moonlit-bag.webp`,
  'Threadgold Bag': `${import.meta.env.BASE_URL}item-icons/threadgold-bag.webp`,
}

// Pickaxe is the only item whose icon changes per quality_tier instead of
// staying fixed per template (every other tier upgrade only recolors via the
// ember effect, see CLAUDE.md's Tier ember effect note) — 5 tier-specific
// PNGs instead of one ITEM_ICON_OVERRIDES entry. qualityTier defaults to
// 'normal' so a caller that doesn't have it yet still gets a valid icon
// rather than falling through to the ⛏️ emoji.
const PICKAXE_ICON_BY_TIER: Record<string, string> = {
  normal: `${import.meta.env.BASE_URL}item-icons/pickaxe-normal.webp`,
  tempered: `${import.meta.env.BASE_URL}item-icons/pickaxe-tempered.webp`,
  infused: `${import.meta.env.BASE_URL}item-icons/pickaxe-infused.webp`,
  radiant: `${import.meta.env.BASE_URL}item-icons/pickaxe-radiant.webp`,
  ascended: `${import.meta.env.BASE_URL}item-icons/pickaxe-ascended.webp`,
}

// Iron/Silver/Gold Ore are 30 real item_templates rows (10 ranks each, see
// 20260926010000_add_mining_ore_catalog.sql) but visually identical within a
// metal regardless of rank — one icon per metal, matched by stripping the
// '(Rank N)' suffix, rather than 30 duplicate ITEM_ICON_OVERRIDES entries.
const ORE_ICON_SRC_BY_METAL: Record<string, string> = {
  Iron: `${import.meta.env.BASE_URL}item-icons/iron-ore.webp`,
  Silver: `${import.meta.env.BASE_URL}item-icons/silver-ore.webp`,
  Gold: `${import.meta.env.BASE_URL}item-icons/gold-ore.webp`,
}
const ORE_RANK_NAME = /^(Iron|Silver|Gold) Ore \(Rank \d+\)$/

export function getGearIconSrc(templateName: string | undefined, qualityTier?: string): string | undefined {
  if (templateName === 'Pickaxe') {
    return PICKAXE_ICON_BY_TIER[qualityTier ?? 'normal'] ?? PICKAXE_ICON_BY_TIER.normal
  }
  const oreMatch = templateName ? ORE_RANK_NAME.exec(templateName) : null
  if (oreMatch) {
    return ORE_ICON_SRC_BY_METAL[oreMatch[1]]
  }
  return templateName ? ITEM_ICON_OVERRIDES[templateName] : undefined
}

// Empty-slot silhouette placeholder (2026-08-26, requested by the user) —
// looks up the current class's own highest-`required_level` template *that
// actually has icon art* for a given slot_type, so EquipmentPanel can show a
// faint silhouette of "what you're working toward" instead of a generic
// emoji on an empty slot. Deliberately walks candidates highest-level-first
// and skips any without art, rather than just taking the single max-level
// template — a chain's true top tier can still be un-iconified (e.g. Cap
// stops at Skysworn (Lv120) art-wise, but Heavensent (Lv126) is the real max
// level), which would otherwise silently fall through to the emoji even
// though a perfectly good lower-tier icon exists (bit Wuxia's Head slot,
// 2026-08-26). `required_class` is null on shared catalogs (Boots today)
// rather than naming every class, so those match regardless of `classId`.
// Where a class has multiple weapon families tied for the top level (e.g.
// Juggernaut's Club/Sword/Blade/Wand all cap at 130), this deterministically
// picks whichever comes first in `templates` — fine for a decorative
// silhouette, no need to prefer one family over another. Returns undefined
// (falls back to the emoji icon) when the class has no gear with art for
// that slot at all (e.g. Twin-soul/Juggernaut's necklace/ring, which don't
// exist in the catalog).
//
// `required_class` gotcha (bit Wuxia's Necklace/Ring/Weapon, 2026-08-26):
// Hunter's *original* Bow/Necklace/Ring/Boots predate the multi-class system
// and were never backfilled with `required_class` — they're `null`, same as
// Boots. But only Boots is actually meant to be shared across every class
// (confirmed design, "the existing shared boots catalog is reused as-is");
// Bow/Necklace/Ring are Hunter-exclusive in practice, just untagged. So a
// bare `required_class === null` fallback isn't safe — it correctly picks up
// Boots but wrongly leaked Hunter's Bow/Necklace into Wuxia's own lookup
// (both outrank Wuxia's real Lv126/127 gear at Lv130). Null now only matches
// when `classId === 'hunter'` (i.e. it really is that legacy Hunter catalog)
// or the slot is Boots specifically (the one deliberately shared exception).
export function getMaxLevelPlaceholderIconSrc(
  templates: ItemTemplate[],
  classId: ClassId,
  slotType: string,
): string | undefined {
  const candidates = templates
    .filter(
      (template) =>
        template.slot_type === slotType &&
        (template.required_class === classId || (template.required_class === null && (classId === 'hunter' || slotType === 'boots'))),
    )
    .sort((a, b) => b.required_level - a.required_level)
  for (const template of candidates) {
    const iconSrc = getGearIconSrc(template.name)
    if (iconSrc) {
      return iconSrc
    }
  }
  return undefined
}

// Exported so other systems needing a tier-rank comparison (e.g. VIP
// auto-salvage's minimum-tier threshold) reuse this instead of redefining
// their own copy of the ladder.
export const QUALITY_ORDER = ['normal', 'tempered', 'infused', 'radiant', 'ascended']

// Mirrors the quality_upgrade Postgres function's tier progression exactly (see
// supabase/migrations/20260803110000_rename_quality_tiers.sql's v_next_tier
// case statement) — used for the Forge preview, which needs to know the *next*
// tier before committing. Returns null when already at Ascended (the real max).
export function nextQualityTier(qualityTier: string): string | null {
  const index = QUALITY_ORDER.indexOf(qualityTier)
  if (index === -1 || index === QUALITY_ORDER.length - 1) {
    return null
  }
  return QUALITY_ORDER[index + 1]
}

export function formatItemLevel(level: number): string {
  return `Lv ${level}`
}

// Display-layer only — the stored item_templates.name is never renamed. Normal
// quality shows the plain name; anything above gets the tier prefixed. Composition
// (see CLAUDE.md's Gear system section), when present, appends a "(+N)" suffix —
// confirmed format, e.g. "Refined Sapling Bow (+1)" — rather than showing on a
// separate line, so the name itself always reflects the item's full identity.
export function formatItemDisplayName(templateName: string, qualityTier: string, compositionLevel = 0): string {
  const base = qualityTier === 'normal' ? templateName : `${QUALITY_LABELS[qualityTier] ?? qualityTier} ${templateName}`
  return compositionLevel > 0 ? `${base} (+${compositionLevel})` : base
}

// Universal Diablo/PoE-style tooltip content for a gear item — the single source
// of truth for what a gear tooltip shows, reused everywhere a gear tile renders
// (InventoryPanel, ForgeUpgradeSlot, ForgeMaterialSlot, EquipmentSlot's Main Hand)
// via InventorySlot's `tooltip` prop, so hovering any of them looks the same.
// Standalone quest/promotion items (Jade Shard, Lunar Chest) have no combat
// stats, level relevance, or Gear Score — they're inert until handed to
// promote_character — so the full gear-tooltip machinery below (Class,
// Sockets, Durability, Gear Score...) doesn't apply to them. Named
// explicitly rather than gated on item_family === 'promotion-material',
// since Umbrite Ore shares that family for historical reasons but is a real
// sellable Mining resource, not a quest item.
const QUEST_ITEM_NAMES = new Set(['Jade Shard', 'Lunar Chest'])

export function buildGearTooltip(item: ItemInstance, template: ItemTemplate | undefined): ItemTooltipData {
  if (template && QUEST_ITEM_NAMES.has(template.name)) {
    return {
      title: template.name,
      icon: getItemIcon(template.slot_type),
      iconSrc: getGearIconSrc(template.name),
      lines: ['Quest Item'],
    }
  }

  // "Class: ___" is display-only for now — just the plain class name (e.g.
  // "Hunter"), not a promotion-tier-specific name (no promotion-tier naming
  // exists yet). Nothing currently blocks equipping across classes; this is
  // flavor/info ahead of that enforcement existing. White (2026-08-13 color
  // pass), like the Lvl line and the "Sockets" header below.
  const classLine: TooltipLine | null =
    template?.required_class && template.required_class in CLASS_DEFINITIONS
      ? { text: `Class: ${CLASS_DEFINITIONS[template.required_class as ClassId].displayName}`, color: TOOLTIP_WHITE }
      : null

  // Only shown when the item actually has a socket (2026-08-02 — see
  // CLAUDE.md's Sockets section) — an item with none gets no extra lines at
  // all, matching "sockets should definitely be displayed if the item
  // actually has them" and not otherwise. A filled socket (2026-08-10, once
  // gem socketing shipped — see socket_gem's SQL) shows the real gem's name
  // and effect via describeSocketedGem, in its own soft green
  // (SOCKETED_GEM_COLOR, 2026-08-13); an unlocked-but-empty one (still jsonb
  // null) shows "Empty" in the block's plain default color, same as before.
  // The "Sockets" header itself is white, like Lvl/Class above.
  const socketLines: TooltipLine[] =
    item.sockets.length > 0
      ? [
          { text: 'Sockets', color: TOOLTIP_WHITE },
          ...item.sockets.map((socket): TooltipLine => {
            if (!socket) {
              return 'Empty'
            }
            const description = describeSocketedGem(socket)
            return description ? { text: description, color: SOCKETED_GEM_COLOR } : 'Empty'
          }),
        ]
      : []

  const compositionBonus = template
    ? computeCompositionBonusStats(template.base_stats, template.slot_type, item.composition_level)
    : {}
  const bonusStats = Object.entries(compositionBonus).map(([key, value]) => `Bonus: +${value} ${key.replace(/_/g, ' ')}`)

  const itemEnchant = item.enchant as { hp?: number; blessPct?: number } | null
  const enchantHp = itemEnchant?.hp
  const blessPct = itemEnchant?.blessPct

  // Progression toward the item's next Composition tier (2026-08-14,
  // requested by the user) — only shown at +1 or higher (a Normal, +0 item
  // shows nothing at all, per the user's explicit "if it's normal,
  // progression shouldn't be visible") and only while there's a further tier
  // to reach (nothing shown once maxed at +12). "X/N" — current points
  // banked toward the next tier, out of how many that tier needs.
  const compositionPointsRequiredForNext =
    item.composition_level > 0 && item.composition_level < TOOLTIP_COMPOSITION_MAX_LEVEL
      ? (TOOLTIP_COMPOSITION_POINTS_REQUIRED_BY_LEVEL[item.composition_level] ?? 0)
      : null
  const progressionLine =
    compositionPointsRequiredForNext !== null ? `Progression: ${item.composition_points}/${compositionPointsRequiredForNext}` : undefined

  // Durability (2026-08-14) — always shown for any non-Quiver gear item
  // (unlike Progression, no gating), white when healthy, red (reusing the
  // existing Ascended-tier red) at 0 to match the "broken" severity shown
  // elsewhere (see InventorySlot/EquipmentSlot's broken badge). Quiver has
  // no durability concept at all (computeMaxDurability returns null for it),
  // so it gets no line, same as every other Quiver exclusion in this game.
  // Positioned after Sockets (2026-08-14, per the user's explicit ordering
  // request) — abbreviated "Dura" label, "X/Y" current/max. Math.ceil, not
  // floor (fixed 2026-08-14, reported by the user: freshly repaired gear
  // read as e.g. "39/40" almost immediately) — durability decays
  // continuously/fractionally, so flooring a value like 39.998 (barely worn)
  // instantly displayed a full point lower than reality. Ceiling instead
  // keeps the displayed number at its current point (e.g. "40") until
  // durability actually drops to or below the next whole point down, so a
  // point is only ever shown as lost once it's genuinely, fully lost — never
  // shows a fake "0/N" either, since decay clamps at exactly 0 (ceil(0) = 0).
  const maxDurability = template ? computeMaxDurability(template.slot_type, template.required_level) : null
  const durabilityLine: TooltipLine | null =
    maxDurability !== null
      ? {
          text: `Dura: ${Math.ceil(item.durability ?? 0)}/${maxDurability}`,
          color: (item.durability ?? 0) <= 0 ? QUALITY_COLORS.ascended : TOOLTIP_WHITE,
        }
      : null

  // Lock (requested by the user) — a locked item can't be Sold/Salvaged/
  // Marketplace-listed/Bank-liquidated-for-composition/fed as Composition
  // fuel (see set_item_locked's SQL guards). Shown first in `lines` so it's
  // the first thing a player notices on a valuable, protected item.
  const lockedLine: TooltipLine | null = item.locked ? { text: '🔒 Locked', color: LOCKED_LINE_COLOR } : null

  // Gear Score (requested by the user) — omitted for Quiver, which is never
  // scored (see claim_gear_snapshot's own item_family/slot exclusions).
  const gearScoreLine = template?.slot_type !== 'quiver' ? `Gear Score: ${computeItemGearScore(item)}` : undefined

  return {
    title: template
      ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level)
      : 'Unknown item',
    titleColor: getQualityColor(item.quality_tier),
    icon: getItemIcon(template?.slot_type),
    iconSrc: getGearIconSrc(template?.name),
    iconColor: getQualityColor(item.quality_tier),
    // Base combat stats (2026-08-13 reorder, per the user's explicit layout
    // request) now sit inside `lines` itself — white stats (Physical
    // Defense/Dodge), then blue stats (Physical/Magic Attack, Magic Defense,
    // Dexterity) — positioned after Class and before Sockets, rather than in
    // a separately-bordered `stats` block below everything. See
    // buildStatTooltipLines' own comment for the white-then-blue ordering.
    lines: [
      ...(lockedLine ? [lockedLine] : []),
      { text: formatItemLevel(item.level), color: TOOLTIP_WHITE },
      ...(classLine ? [classLine] : []),
      ...(template ? buildStatTooltipLines(template.base_stats, item.quality_tier, template.item_family) : []),
      ...socketLines,
      ...(durabilityLine ? [durabilityLine] : []),
    ],
    bonusStats: bonusStats.length > 0 ? bonusStats : undefined,
    enchantLine: enchantHp ? `Enchanted HP: ${enchantHp}` : undefined,
    blessLine: blessPct ? `Damage: -${blessPct}%` : undefined,
    progressionLine,
    gearScoreLine,
  }
}
