import type { EnemyTypeDef } from '../zones/zoneData'
import { expRewardForLevel } from '../stats/expCurve'

// PLACEHOLDER rare-monster odds/multipliers — matches CLAUDE.md's confirmed design
// (5% chance per monster, 2x HP, 5x gold/EXP) but the underlying zone economy these
// multiply against is itself still a placeholder. Shared by both the live combat
// resolver (useCombatStore) and the offline-progress simulator (offlineProgress.ts)
// so a monster's odds/scaling can never drift between "online" and "offline" combat.
export const RARE_CHANCE = 0.05
export const RARE_HP_MULTIPLIER = 2
export const RARE_REWARD_MULTIPLIER = 5

export function rollIsRare(): boolean {
  return Math.random() < RARE_CHANCE
}

export function spawnMonsterHp(type: EnemyTypeDef, isRare: boolean): number {
  return isRare ? type.maxHp * RARE_HP_MULTIPLIER : type.maxHp
}

// Level-difference name color + EXP scaling — signals a strength gap between
// character and monster (diff = characterLevel - monsterLevel), same coloring
// convention as the real game: White is an even match, Green means the
// character is comfortably stronger (reduced EXP for killing something too
// weak to matter), Red/Black mean the monster is stronger (bonus EXP for
// punching above your level). Only EXP is scaled — gold rewards are untouched.
export type LevelDiffColor = 'white' | 'green' | 'red' | 'black'

export function getLevelDiffColor(characterLevel: number, monsterLevel: number): LevelDiffColor {
  const diff = characterLevel - monsterLevel
  if (diff <= -5) return 'black'
  if (diff <= -3) return 'red'
  if (diff >= 3) return 'green'
  return 'white'
}

// PLACEHOLDER multipliers, unresolved per CLAUDE.md like every other economy
// number — a reasonable "bonus for punching up, penalty for punching down"
// curve, not a sourced/tuned formula.
const EXP_MULTIPLIER_BY_COLOR: Record<LevelDiffColor, number> = {
  black: 2,
  red: 1.5,
  white: 1,
  green: 0.5,
}

export function expMultiplierForLevelDiff(characterLevel: number, monsterLevel: number): number {
  return EXP_MULTIPLIER_BY_COLOR[getLevelDiffColor(characterLevel, monsterLevel)]
}

// Level-gap Defense debuff (confirmed with the user, 2026-08-05, matching a
// real Conquer Online mechanic they recalled: "monsters being able to 1 hit
// my Trojan but as soon as I got 1 level the monsters then start hitting 1s
// on me"). Whichever side is actually mismatched in a fight gets its own
// Defense stripped proportionally — the side that's ahead never gets an
// extra bonus applied to itself, and the side that's behind never gets extra
// protection, so an even ("white") matchup stays neutral for *incoming*
// damage even though it already gives a modest outgoing bonus. Reuses the
// same White/Green/Red/Black color exactly as expMultiplierForLevelDiff
// above, just two new multiplier tables instead of a third color scheme.
// PLACEHOLDER magnitudes, same disclosed-not-final status as every other
// combat number in this game.
const MONSTER_DEFENSE_MULTIPLIER_BY_COLOR: Record<LevelDiffColor, number> = {
  green: 0.5,
  white: 0.75,
  red: 1,
  black: 1,
}

const PLAYER_DEFENSE_MULTIPLIER_BY_COLOR: Record<LevelDiffColor, number> = {
  green: 1,
  white: 1,
  // Steepened 2026-08-07 (confirmed with the user: "a significant enough
  // reduction to get hit harder by those monsters") — Red halved (was 0.75,
  // barely a 25% strip) and Black down to a token 10% (was 0.5). May need a
  // per-class pass later; flat for now.
  red: 0.5,
  black: 0.1,
}

// Outgoing side — the monster's own Defense (see monsterDefense below) is
// reduced when the character comfortably outlevels it (Green/White), and
// left alone when the monster outlevels the character (Red/Black, no bonus
// for punching up beyond the existing EXP bonus). Mirrored in resolve-combat
// since this changes real kill rates/rewards, not just client-side feel.
export function monsterDefenseMultiplierForLevelDiff(characterLevel: number, monsterLevel: number): number {
  return MONSTER_DEFENSE_MULTIPLIER_BY_COLOR[getLevelDiffColor(characterLevel, monsterLevel)]
}

// Incoming side — the player's own physicalDefense is reduced when the
// monster outlevels the character (Red/Black), and left alone otherwise —
// this is what makes a genuinely stronger monster "hit a lot harder," per
// the user's own framing, rather than a flat Attack-minus-Defense regardless
// of level gap. Client-only (see resolvePhysicalDamage's own comment below
// for why incoming damage was never simulated server-side to begin with).
export function playerDefenseMultiplierForLevelDiff(characterLevel: number, monsterLevel: number): number {
  return PLAYER_DEFENSE_MULTIPLIER_BY_COLOR[getLevelDiffColor(characterLevel, monsterLevel)]
}

// expMultiplier — the White/Green/Red/Black level-diff bonus (see
// expMultiplierForLevelDiff above). Visual-log flavor only now (2026-08-11
// rewrite) — the kill-moment log line's own gold/EXP numbers, no longer fed
// into any predicted-reward math (see expectedRewardPerAttack below, which
// computes the real deterministic total independently).
export function killRewards(type: EnemyTypeDef, isRare: boolean, expMultiplier: number): { gold: number; exp: number } {
  const rareMultiplier = isRare ? RARE_REWARD_MULTIPLIER : 1
  return {
    gold: type.goldReward * rareMultiplier,
    exp: Math.round(expRewardForLevel(type.level) * rareMultiplier * expMultiplier),
  }
}

// Comet/Fallen Star kill-drop odds — confirmed by the user (2026-07-30), not a
// placeholder like the rest of this file's numbers. Independent per-kill rolls,
// not affected by rare status (rare only multiplies HP/gold/EXP per the
// existing confirmed design above). Reverted back to flat (2026-08-03) — a
// same-day earlier attempt at fixing "Quailwing farming is too good" scaled
// *this* base rate by monster level, but the user clarified that was the
// wrong lever entirely: the base rate itself was never the problem, and
// should stay untouched. The actual fix is the Kill Count achievement's own
// bonus-drop-chance multiplier scaling by level instead — see
// killCountBonusDropMultiplier in achievementData.ts /
// resolve-combat/index.ts, not here. Shared by live combat and the offline
// simulator so odds can never drift between the two, same convention as
// every other roll in this module.
export const COMET_DROP_CHANCE = 1 / 500
export const FALLEN_STAR_DROP_CHANCE = 1 / 20000

// cometMultiplier/fallenStarMultiplier (2026-08-06, Achievements rework;
// made per-zone 2026-08-07; split into two independent params 2026-08-29 for
// the Gold Donation Event's buff, which can boost only one of these two —
// see resolve-combat/index.ts's own copy) — each combines the account-wide
// Achievements drop-bonus buff (players.account_zone_drop_bonus_pct, scoped
// to whichever zone the fought monster belongs to) with the event's buff
// when active for that category. Default to 1 (no bonus) for any caller that
// doesn't have them handy.
export function rollBonusCurrencyDrops(cometMultiplier = 1, fallenStarMultiplier = 1): { comets: number; fallenStars: number } {
  return {
    comets: Math.random() < COMET_DROP_CHANCE * cometMultiplier ? 1 : 0,
    fallenStars: Math.random() < FALLEN_STAR_DROP_CHANCE * fallenStarMultiplier ? 1 : 0,
  }
}

// Jade Shard (2026-09-01, Class Promotion tier-70 material) — a flat
// per-kill chance, same independent-roll shape as Comet/Fallen Star above,
// but scoped to exactly 3 monsters instead of every kill (frostpelt/
// venomkin/dunecrawler, levels 60/65/67 — the only monsters in that band).
// PLACEHOLDER rate, unlike the Comet/Fallen Star numbers above. Deliberately
// NOT the generic level-appropriate-family drop system (Jade Shard's
// item_family is 'promotion-material', in NON_DROPPABLE_FAMILIES, so that
// system never picks it) — this is its only drop path. Mirrored server-side
// in resolve-combat/index.ts — must stay in sync.
export const JADE_SHARD_DROP_CHANCE = 1 / 300
export const JADE_SHARD_MONSTER_IDS = ['frostpelt', 'venomkin', 'dunecrawler']

export function rollJadeShardDrop(monsterId: string | null): boolean {
  return monsterId !== null && JADE_SHARD_MONSTER_IDS.includes(monsterId) && Math.random() < JADE_SHARD_DROP_CHANCE
}

// PLACEHOLDER monster attack cadence — fixed at once per second, not derived
// from any per-monster "attack speed" concept (none exists yet, unlike the
// player's own derived.attackSpeed).
export const MONSTER_ATTACK_INTERVAL_MS = 1000

// Min/max hit range (confirmed with the user, 2026-07-31) — attack is now a
// rolled range rather than a flat number, for both the player and monsters.
// Formula-derived from the existing single stat value rather than stored per
// item/monster — no schema change needed, every base_stats.physical_attack/
// magic_attack and EnemyTypeDef.attackDamage number is now just interpreted
// as the midpoint wherever it's read.
//
// Narrowed 2026-08-11 (was 0.5/1.5, a ±50%/3x min-max ratio) — the original
// ±50% spread was only ever validated against the level-1 Iron Ring
// (co.99.com/guide/items/rings.shtml: min 1/max 3 at midpoint 2, a tiny-
// integer rounding outlier), but the fuller reference tables
// (reference/conquer-items/bows.md/rings.md) show real Bows running a much
// tighter ~1.2-1.33x max/min ratio across nearly every level, narrowing
// further at the very top end. 0.9/1.1 (a 1.222x ratio) was chosen to match
// Bows specifically, since Hunter/Bow is the only playable class+weapon
// today — Rings run wider in the real data (~1.8-2.5x through most levels,
// only converging to 1.5x at the very top tiers), a known, accepted
// under-fit for the secondary stat given this is one shared constant across
// every physical_attack/magic_attack roll.
export const DAMAGE_ROLL_MIN_RATIO = 0.9
export const DAMAGE_ROLL_MAX_RATIO = 1.1

export function damageRangeFromMidpoint(midpoint: number): { min: number; max: number } {
  const min = Math.max(1, Math.round(midpoint * DAMAGE_ROLL_MIN_RATIO))
  const max = Math.max(min, Math.round(midpoint * DAMAGE_ROLL_MAX_RATIO))
  return { min, max }
}

export function rollDamageInRange(midpoint: number): number {
  const { min, max } = damageRangeFromMidpoint(midpoint)
  return min + Math.floor(Math.random() * (max - min + 1))
}

// Rare status only affects HP/rewards per CLAUDE.md's confirmed design (2x HP,
// 5x gold/EXP) — deliberately not a harder-hitting monster, so this ignores
// isRare unlike spawnMonsterHp/killRewards above.
export function monsterAttackDamage(type: EnemyTypeDef): number {
  return rollDamageInRange(type.attackDamage)
}

// Simplified player-outgoing damage formula (confirmed direction 2026-07-30):
// the user supplied the real Conquer Online formula, which layers in Rebirth,
// Tortoise%, Blessed%, crit multipliers, Potency scaling, and Battle Power
// instant-kill/damage-cap interactions — none of those systems exist in this
// game yet, so this deliberately keeps only the core "Attack minus Defense,
// with a minimum-damage floor" shape (the same floor concept CLAUDE.md already
// flagged as a real later-patch reference point) rather than stubbing out
// mechanics that don't exist. Revisit/expand once Rebirth or skills are
// actually designed.
//
// Also closes a previously-documented gap: damage used to be `physicalAttack`
// alone, so a Spirit-scaling class (Wuxia, physicalAttack always 0 per its
// Str-0 starting attributes) dealt zero damage. Using physicalAttack +
// magicAttack fixes this generally rather than branching on class — for every
// class so far, starting attributes only ever put points in one of Strength
// or Spirit, so exactly one of the two addends is ever nonzero in practice.
const MIN_DAMAGE_PERCENT_OF_ATTACK = 0.1

// Monster Defense — formula-derived from level (not stored on EnemyTypeDef
// itself, since it's cheap to compute and keeps zoneData.ts free of yet
// another hand-tuned field), tied to the same "independently formula-derived,
// not sourced" convention the rest of each zone's stats already follow.
// characterLevel feeds monsterDefenseMultiplierForLevelDiff above (2026-08-05)
// — a monster the character has comfortably outleveled loses a real chunk of
// its own Defense, not just a smaller EXP reward.
export function monsterDefense(type: EnemyTypeDef, characterLevel: number): number {
  const base = Math.round(type.level * 1.5)
  return Math.round(base * monsterDefenseMultiplierForLevelDiff(characterLevel, type.level))
}

// Now that armor slots are functional (2026-07-31), a player's Defense is no
// longer always 0 — monsterAttackDamage's mitigation happens in
// useCombatStore.runTick, the same place player HP already lives (incoming
// damage/knockout was never simulated server-side, an already-accepted gap —
// see resolve-combat's own docs — so this fits that same boundary).
export function resolvePhysicalDamage(attack: number, defense: number): number {
  const mitigated = attack - defense
  const floor = Math.round(attack * MIN_DAMAGE_PERCENT_OF_ATTACK)
  return Math.max(mitigated, floor, 1)
}

// Enchantress "Bless" tab (2026-08-13, see gemCatalog.ts's BLESS_PCT_STEPS) —
// a flat % reduction applied to incoming monster damage *after*
// resolvePhysicalDamage's own Attack-minus-Defense mitigation, not folded
// into the Defense calculation itself (Bless is a gear-enchant bonus, not a
// Defense stat). Capped defensively at MAX_DAMAGE_REDUCTION_PCT, the same
// "never let a stacked bonus fully zero out combat" shape MAX_DODGE_CHANCE
// already uses below — stacking every equipped item's own +7% cap (7 slots)
// would reach 49% today, well under the cap, but the cap exists so this
// can't runaway if more slots/sources are added later.
const MAX_DAMAGE_REDUCTION_PCT = 90

export function applyDamageReduction(damage: number, reductionPct: number): number {
  const clampedPct = Math.min(Math.max(reductionPct, 0), MAX_DAMAGE_REDUCTION_PCT)
  return Math.max(1, Math.round(damage * (1 - clampedPct / 100)))
}

// New dodge/miss-chance mechanic (confirmed with the user, 2026-07-31) — a
// player can now fully avoid an incoming monster attack, using boots' own
// dodge stat plus Agility (see derivedStats.ts). PLACEHOLDER capped-linear
// curve, capped at 50% — unresolved/unsourced like the rest of this combat
// math, tune later. Client-only (see useCombatStore.runTick's
// monster-attack-back block) — not mirrored in resolve-combat, since
// incoming damage/player HP was never simulated server-side to begin with.
// This constant is also shared by rollAttackLands below (the player's own
// outgoing hit chance vs. monster Dodge), which IS mirrored server-side.
//
// Lowered 2026-08-11 (was 0.005/0.5%-per-point, confirmed with the user as
// "way too high") — Hunter is the Agility specialist and its Agility alone
// crosses 100 by around level 45 (see classes.ts's ATTRIBUTE_ANCHORS), which
// already saturated the 50% cap on its own from that point on, before any
// Boots/composition dodge bonus. 0.0015 means only a true best-in-slot
// level-130 Hunter (Agility 275 + Ascended Boots' dodge, roughly 341 points)
// approaches the 50% cap, instead of any mid-30s Hunter sitting there by
// default.
const DODGE_CHANCE_PER_POINT = 0.0015
const MAX_DODGE_CHANCE = 0.5

export function rollIsHit(dodge: number): boolean {
  const dodgeChance = Math.min(dodge * DODGE_CHANCE_PER_POINT, MAX_DODGE_CHANCE)
  return Math.random() >= dodgeChance
}

// Monster Dodge — new (2026-08-02, confirmed design), closes the previous
// "one-directional dodge" gap: the player's own outgoing attacks could never
// miss, only incoming ones could be avoided. Formula-derived from level, same
// "not stored on EnemyTypeDef, not sourced" convention as monsterDefense
// above — informed by real Conquer monster Dodge data
// (reference/conquer-items/monsters.md, roughly 36→1000+ across levels
// 1-120) purely for *pacing feel*, not copied directly, since that data
// assumes a completely different player power scale than this game's own
// attribute curve (see classes.ts's ATTRIBUTE_ANCHORS). Calibrated instead
// against this game's own Agility growth so it's a meaningful-but-not-
// overwhelming threat for low-Agility melee classes (Warrior/Trojan/Taoist
// top out around 75 Agility at level 130), while naturally becoming a
// non-factor for a well-built Hunter (Agility specialist, tops out at 275) —
// that class asymmetry is intentional flavor, not an oversight.
export function monsterDodge(type: EnemyTypeDef): number {
  return Math.round(type.level * 0.8)
}

// The reverse of rollIsHit above — the player's own Dexterity (`derived.
// dexterity`, a separate stat from `dodge` as of 2026-08-02 — see
// derivedStats.ts) reduces the monster's effective Dodge before the same
// per-point/cap curve applies. Confirmed design intent: this is what makes
// Ascended gear (which scales the same dexterity stat via QUALITY_STAT_
// MULTIPLIERS) feel meaningfully better than Normal gear beyond just raw
// damage — it also lands more often, not just hits harder.
export function rollAttackLands(playerDexterity: number, monsterDodgeValue: number): boolean {
  const missChance = Math.min(Math.max(0, monsterDodgeValue - playerDexterity) * DODGE_CHANCE_PER_POINT, MAX_DODGE_CHANCE)
  return Math.random() >= missChance
}

// expectedRewardPerAttack (the 2026-08-11 rewrite's smooth per-tick
// predictive accumulator) was removed 2026-11, requested by the user —
// reward-on-kill (see resolve-combat/index.ts's own rewrite) means the
// client no longer predicts gold/EXP ahead of the server's confirmation at
// all; useCombatStore.runTick no longer calls this. The underlying
// deterministic hitChance/expectedDamagePerHit math it was built from still
// lives in resolve-combat/index.ts, now counted in whole-kill units instead
// of a continuous rate.
