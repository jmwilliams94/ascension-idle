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

function scaledStat(baseStats: Record<string, number>, key: string, qualityTier: string): number | undefined {
  const base = baseStats[key]
  if (typeof base !== 'number') {
    return undefined
  }
  const multiplier = QUALITY_STAT_MULTIPLIERS[qualityTier] ?? 1
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
// yet, and Shield/Bag/Bracelet/Heavy Ring/Taoist Cap/Magic Sword have no
// implemented slot_type to key off of).
export const COMPOSITION_BONUS_PCT_PER_TIER = 0.05

export const COMPOSITION_BONUS_STAT_KEYS: Record<string, string[]> = {
  weapon: ['physical_attack', 'magic_attack'],
  ring: ['physical_attack'],
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
    if (item.durability <= 0) continue

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
// compute_item_gear_score function (20260930010000_gear_lock_and_gear_score.sql)
// — must stay in sync. Quality tier worth its QUALITY_ORDER index (0-4, same
// battle-power weighting already documented in CLAUDE.md), each unlocked
// socket worth 1 (filled or empty, 0-2), composition_level worth 1 per point
// (0-12), Enchant HP worth 1 point per tier range reached (0-3, ranges from
// ENCHANT_HP_RANGE_BY_TIER), Bless worth 1 point per ladder step reached (0-4,
// BLESS_PCT_STEPS) — matches the user's own worked example (1% -> 1pt, 5% ->
// 3pts) exactly.
export function computeItemGearScore(item: Pick<ItemInstance, 'quality_tier' | 'sockets' | 'composition_level' | 'enchant'>): number {
  const qualityScore = Math.max(0, QUALITY_ORDER.indexOf(item.quality_tier))
  const socketScore = item.sockets.length
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
// 20260730060000_add_sell_item.sql) — must stay in sync, same pattern as
// every other Forge/Shop cost preview in this codebase. PLACEHOLDER: half of
// the template's buy price, scaled by quality — unresolved per CLAUDE.md like
// the rest of this economy, and deliberately ignores composition level for
// now (a minimal first pass, not a full item-valuation redesign).
export function previewSellPrice(price: number, qualityTier: string): number {
  return Math.round(price * 0.5 * (QUALITY_STAT_MULTIPLIERS[qualityTier] ?? 1))
}

// Client-side mirror of salvage_item's SQL case statement (see
// 20260807060000_salvage_ap_table_and_bonus_rebalance.sql) — must stay in
// sync. Forge's Salvage tab: no gold, exactly the same per-tier AP as
// sell_item (Salvage's only difference from Sell is forfeiting the gold).
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

export function formatBaseStats(baseStats: Record<string, number>, qualityTier: string): string {
  return Object.entries(baseStats)
    .map(([key]) => {
      const value = scaledStat(baseStats, key, qualityTier)
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
export function buildStatTooltipLines(baseStats: Record<string, number>, qualityTier: string): TooltipLine[] {
  const toLine = (key: string): TooltipLine => {
    const value = scaledStat(baseStats, key, qualityTier)
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
  'Sapling Bow': `${import.meta.env.BASE_URL}item-icons/sapling-bow.png`,
  "Ranger's Bow": `${import.meta.env.BASE_URL}item-icons/rangers-bow.png`,
  'Lucky Bow': `${import.meta.env.BASE_URL}item-icons/lucky-bow.png`,
  'Thornwood Bow': `${import.meta.env.BASE_URL}item-icons/thornwood-bow.png`,
  'Evergreen Bow': `${import.meta.env.BASE_URL}item-icons/evergreen-bow.png`,
  'Stonewood Bow': `${import.meta.env.BASE_URL}item-icons/stonewood-bow.png`,
  'Gale Bow': `${import.meta.env.BASE_URL}item-icons/gale-bow.png`,
  'Vermil Bow': `${import.meta.env.BASE_URL}item-icons/vermil-bow.png`,
  "Ram's Horn Bow": `${import.meta.env.BASE_URL}item-icons/rams-horn-bow.png`,
  'Sovereign Bow': `${import.meta.env.BASE_URL}item-icons/sovereign-bow.png`,
  'Farreach Bow': `${import.meta.env.BASE_URL}item-icons/farreach-bow.png`,
  "Drover's Bow": `${import.meta.env.BASE_URL}item-icons/drovers-bow.png`,
  'Forgesteel Bow': `${import.meta.env.BASE_URL}item-icons/forgesteel-bow.png`,
  'Windwing Bow': `${import.meta.env.BASE_URL}item-icons/windwing-bow.png`,
  'Stripeback Bow': `${import.meta.env.BASE_URL}item-icons/stripeback-bow.png`,
  'Heartwood Bow': `${import.meta.env.BASE_URL}item-icons/heartwood-bow.png`,
  'Runed Bow': `${import.meta.env.BASE_URL}item-icons/runed-bow.png`,
  'Starfall Bow': `${import.meta.env.BASE_URL}item-icons/starfall-bow.png`,
  'Nightglow Bow': `${import.meta.env.BASE_URL}item-icons/nightglow-bow.png`,
  'Rosemark Bow': `${import.meta.env.BASE_URL}item-icons/rosemark-bow.png`,
  'Wyrmstring Bow': `${import.meta.env.BASE_URL}item-icons/wyrmstring-bow.png`,
  'Timeworn Bow': `${import.meta.env.BASE_URL}item-icons/timeworn-bow.png`,
  'Skyborne Bow': `${import.meta.env.BASE_URL}item-icons/skyborne-bow.png`,
  'Sorcerous Bow': `${import.meta.env.BASE_URL}item-icons/sorcerous-bow.png`,
  'Emberwing Bow': `${import.meta.env.BASE_URL}item-icons/emberwing-bow.png`,
  'Voidcaller Bow': `${import.meta.env.BASE_URL}item-icons/voidcaller-bow.png`,
  'Mole Hat': `${import.meta.env.BASE_URL}item-icons/mole-hat.png`,
  'Lynx Hat': `${import.meta.env.BASE_URL}item-icons/lynx-hat.png`,
  'Coyote Hat': `${import.meta.env.BASE_URL}item-icons/coyote-hat.png`,
  'Ocelot Hat': `${import.meta.env.BASE_URL}item-icons/ocelot-hat.png`,
  'Simian Hat': `${import.meta.env.BASE_URL}item-icons/simian-hat.png`,
  'Ferret Hat': `${import.meta.env.BASE_URL}item-icons/ferret-hat.png`,
  'Stag Hat': `${import.meta.env.BASE_URL}item-icons/stag-hat.png`,
  'Bullhide Hat': `${import.meta.env.BASE_URL}item-icons/bullhide-hat.png`,
  'Talon Hat': `${import.meta.env.BASE_URL}item-icons/talon-hat.png`,
  'Finhead Hat': `${import.meta.env.BASE_URL}item-icons/finhead-hat.png`,
  'Cinderplume Hat': `${import.meta.env.BASE_URL}item-icons/cinderplume-hat.png`,
  'Fawnhide Coat': `${import.meta.env.BASE_URL}item-icons/fawnhide-coat.png`,
  'Vixen Coat': `${import.meta.env.BASE_URL}item-icons/vixen-coat.png`,
  'Timberwolf Coat': `${import.meta.env.BASE_URL}item-icons/timberwolf-coat.png`,
  'Dappled Coat': `${import.meta.env.BASE_URL}item-icons/dappled-coat.png`,
  'Silverback Coat': `${import.meta.env.BASE_URL}item-icons/silverback-coat.png`,
  'Quilted Coat': `${import.meta.env.BASE_URL}item-icons/quilted-coat.png`,
  'Finscale Coat': `${import.meta.env.BASE_URL}item-icons/finscale-coat.png`,
  'Hidebound Coat': `${import.meta.env.BASE_URL}item-icons/hidebound-coat.png`,
  'Skyfeather Coat': `${import.meta.env.BASE_URL}item-icons/skyfeather-coat.png`,
  'Wyrmhide Coat': `${import.meta.env.BASE_URL}item-icons/wyrmhide-coat.png`,
  'Emberplate Coat': `${import.meta.env.BASE_URL}item-icons/emberplate-coat.png`,
  'Twine Necklace': `${import.meta.env.BASE_URL}item-icons/twine-necklace.png`,
  'Wisp Necklace': `${import.meta.env.BASE_URL}item-icons/wisp-necklace.png`,
  'Locket Necklace': `${import.meta.env.BASE_URL}item-icons/locket-necklace.png`,
  'Emerald Necklace': `${import.meta.env.BASE_URL}item-icons/emerald-necklace.png`,
  'Quartz Necklace': `${import.meta.env.BASE_URL}item-icons/quartz-necklace.png`,
  'Sunmetal Necklace': `${import.meta.env.BASE_URL}item-icons/sunmetal-necklace.png`,
  'Whitesteel Necklace': `${import.meta.env.BASE_URL}item-icons/whitesteel-necklace.png`,
  'Obsidian Necklace': `${import.meta.env.BASE_URL}item-icons/obsidian-necklace.png`,
  "Serpent's Necklace": `${import.meta.env.BASE_URL}item-icons/serpents-necklace.png`,
  'Reliquary Necklace': `${import.meta.env.BASE_URL}item-icons/reliquary-necklace.png`,
  'Umbral Necklace': `${import.meta.env.BASE_URL}item-icons/umbral-necklace.png`,
  'Reverie Necklace': `${import.meta.env.BASE_URL}item-icons/reverie-necklace.png`,
  'Cyclone Necklace': `${import.meta.env.BASE_URL}item-icons/cyclone-necklace.png`,
  'Tin Ring': `${import.meta.env.BASE_URL}item-icons/tin-ring.png`,
  'Brass Ring': `${import.meta.env.BASE_URL}item-icons/brass-ring.png`,
  'Pewter Ring': `${import.meta.env.BASE_URL}item-icons/pewter-ring.png`,
  'Gilded Ring': `${import.meta.env.BASE_URL}item-icons/gilded-ring.png`,
  'Violet Ring': `${import.meta.env.BASE_URL}item-icons/violet-ring.png`,
  'Bonewhite Ring': `${import.meta.env.BASE_URL}item-icons/bonewhite-ring.png`,
  'Verdant Ring': `${import.meta.env.BASE_URL}item-icons/verdant-ring.png`,
  'Opal Ring': `${import.meta.env.BASE_URL}item-icons/opal-ring.png`,
  'Banded Ring': `${import.meta.env.BASE_URL}item-icons/banded-ring.png`,
  'Glass Ring': `${import.meta.env.BASE_URL}item-icons/glass-ring.png`,
  'Facet Ring': `${import.meta.env.BASE_URL}item-icons/facet-ring.png`,
  'Wyrmscale Ring': `${import.meta.env.BASE_URL}item-icons/wyrmscale-ring.png`,
  'Weeping Ring': `${import.meta.env.BASE_URL}item-icons/weeping-ring.png`,
  'Oathbound Ring': `${import.meta.env.BASE_URL}item-icons/oathbound-ring.png`,
  'Stormcaller Ring': `${import.meta.env.BASE_URL}item-icons/stormcaller-ring.png`,
  'Rawhide Boots': `${import.meta.env.BASE_URL}item-icons/rawhide-boots.png`,
  'Fawnskin Boots': `${import.meta.env.BASE_URL}item-icons/fawnskin-boots.png`,
  'Padded Boots': `${import.meta.env.BASE_URL}item-icons/padded-boots.png`,
  'Hawkstep Boots': `${import.meta.env.BASE_URL}item-icons/hawkstep-boots.png`,
  'Featherstep Boots': `${import.meta.env.BASE_URL}item-icons/featherstep-boots.png`,
  'Scalehide Boots': `${import.meta.env.BASE_URL}item-icons/scalehide-boots.png`,
  'Viperskin Boots': `${import.meta.env.BASE_URL}item-icons/viperskin-boots.png`,
  'Prowler Boots': `${import.meta.env.BASE_URL}item-icons/prowler-boots.png`,
  'Spotted Boots': `${import.meta.env.BASE_URL}item-icons/spotted-boots.png`,
  'Direbeast Boots': `${import.meta.env.BASE_URL}item-icons/direbeast-boots.png`,
  'Nimble Boots': `${import.meta.env.BASE_URL}item-icons/nimble-boots.png`,
  'Charmed Boots': `${import.meta.env.BASE_URL}item-icons/charmed-boots.png`,
  'Liberty Boots': `${import.meta.env.BASE_URL}item-icons/liberty-boots.png`,
  'Frostbite Boots': `${import.meta.env.BASE_URL}item-icons/frostbite-boots.png`,
  "Hunter's Quiver": `${import.meta.env.BASE_URL}item-icons/quiver.png`,
  // Money Bag classes 1-10 (2026-08-13) — escalating sack art from worn/
  // patched burlap up through a bejeweled velvet pouch and finally a
  // crowned black-velvet purse, matching the Class 1-10 gold ramp (see
  // forgeCosts.ts's MONEY_BAG_GOLD_BY_CLASS). Full set now, no emoji
  // fallback needed for any class.
  'Class 1 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-1.png`,
  'Class 2 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-2.png`,
  'Class 3 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-3.png`,
  'Class 4 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-4.png`,
  'Class 5 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-5.png`,
  'Class 6 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-6.png`,
  'Class 7 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-7.png`,
  'Class 8 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-8.png`,
  'Class 9 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-9.png`,
  'Class 10 Money Bag': `${import.meta.env.BASE_URL}item-icons/money-bag-10.png`,
  // Random Gem Bag (2026-08-14) — user-supplied black-velvet crowned pouch
  // art, same trim/pad/resize-to-160 pipeline as every other icon here.
  'Random Gem Bag': `${import.meta.env.BASE_URL}item-icons/gem-bag.png`,
}

export function getGearIconSrc(templateName: string | undefined): string | undefined {
  return templateName ? ITEM_ICON_OVERRIDES[templateName] : undefined
}

const QUALITY_ORDER = ['normal', 'tempered', 'infused', 'radiant', 'ascended']

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
// confirmed format, e.g. "Refined Wooden Sword (+1)" — rather than showing on a
// separate line, so the name itself always reflects the item's full identity.
export function formatItemDisplayName(templateName: string, qualityTier: string, compositionLevel = 0): string {
  const base = qualityTier === 'normal' ? templateName : `${QUALITY_LABELS[qualityTier] ?? qualityTier} ${templateName}`
  return compositionLevel > 0 ? `${base} (+${compositionLevel})` : base
}

// Universal Diablo/PoE-style tooltip content for a gear item — the single source
// of truth for what a gear tooltip shows, reused everywhere a gear tile renders
// (InventoryPanel, ForgeUpgradeSlot, ForgeMaterialSlot, EquipmentSlot's Main Hand)
// via InventorySlot's `tooltip` prop, so hovering any of them looks the same.
export function buildGearTooltip(item: ItemInstance, template: ItemTemplate | undefined): ItemTooltipData {
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
      ? { text: `Dura: ${Math.ceil(item.durability)}/${maxDurability}`, color: item.durability <= 0 ? QUALITY_COLORS.ascended : TOOLTIP_WHITE }
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
      ...(template ? buildStatTooltipLines(template.base_stats, item.quality_tier) : []),
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
