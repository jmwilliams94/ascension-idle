import type { EnemyTypeDef } from '../zones/zoneData'

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

export function killRewards(type: EnemyTypeDef, isRare: boolean, characterLevel: number): { gold: number; exp: number } {
  const rareMultiplier = isRare ? RARE_REWARD_MULTIPLIER : 1
  const expMultiplier = expMultiplierForLevelDiff(characterLevel, type.level)
  return {
    gold: type.goldReward * rareMultiplier,
    exp: Math.round(type.expReward * rareMultiplier * expMultiplier),
  }
}

// Meteor/Dragonball kill-drop odds — now scaled by the fought monster's own
// level (corrected 2026-08-03, confirmed with the user, supersedes the flat
// 1/500 / 1/20000 rates from 2026-07-30). Without this, a low-level/fast-kill
// monster (e.g. level-1 Quailwing) produced identical odds per kill as a much
// harder, slower-to-kill endgame monster — since low-level monsters die in
// far fewer hits, that made camping the very first zone forever strictly
// optimal for currency farming, the opposite of the intended pacing (and
// compounded further by the Kill Count achievement's own bonus-drop-chance
// multiplier, trivially easy to max out on a fast-dying monster). PLACEHOLDER
// curve — linear on monster level from 1 to 130, DragonBall:Meteor ratio held
// constant at 40x (matching the original flat rates' own ratio) — only the
// *shape* (scales up with level) is confirmed, not these exact numbers, same
// as every other economy number in this game. Shared by live combat and the
// offline simulator so odds can never drift between the two, same convention
// as every other roll in this module.
const METEOR_DROP_CHANCE_AT_LEVEL_1 = 1 / 2000
const METEOR_DROP_CHANCE_AT_LEVEL_130 = 1 / 100
const DRAGONBALL_DROP_CHANCE_AT_LEVEL_1 = 1 / 80000
const DRAGONBALL_DROP_CHANCE_AT_LEVEL_130 = 1 / 4000
const MAX_MONSTER_LEVEL_FOR_DROP_SCALING = 130

function dropChanceLevelT(monsterLevel: number): number {
  return Math.min(Math.max((monsterLevel - 1) / (MAX_MONSTER_LEVEL_FOR_DROP_SCALING - 1), 0), 1)
}

export function meteorDropChance(monsterLevel: number): number {
  const t = dropChanceLevelT(monsterLevel)
  return METEOR_DROP_CHANCE_AT_LEVEL_1 + (METEOR_DROP_CHANCE_AT_LEVEL_130 - METEOR_DROP_CHANCE_AT_LEVEL_1) * t
}

export function dragonballDropChance(monsterLevel: number): number {
  const t = dropChanceLevelT(monsterLevel)
  return DRAGONBALL_DROP_CHANCE_AT_LEVEL_1 + (DRAGONBALL_DROP_CHANCE_AT_LEVEL_130 - DRAGONBALL_DROP_CHANCE_AT_LEVEL_1) * t
}

export function rollBonusCurrencyDrops(monsterLevel: number): { meteors: number; dragonballs: number } {
  return {
    meteors: Math.random() < meteorDropChance(monsterLevel) ? 1 : 0,
    dragonballs: Math.random() < dragonballDropChance(monsterLevel) ? 1 : 0,
  }
}

// PLACEHOLDER monster attack cadence — fixed at once per second, not derived
// from any per-monster "attack speed" concept (none exists yet, unlike the
// player's own derived.attackSpeed).
export const MONSTER_ATTACK_INTERVAL_MS = 1000

// Min/max hit range (confirmed with the user, 2026-07-31) — attack is now a
// rolled range rather than a flat number, for both the player and monsters,
// matching the real reference data's per-tier Min/Max Atk columns
// (co.99.com/guide/items/rings.shtml's Iron Ring: min 1/max 3 at a midpoint
// of 2, exactly a ±50% spread). Formula-derived from the existing single
// stat value rather than stored per item/monster — no schema change needed,
// every base_stats.physical_attack/magic_attack and EnemyTypeDef.attackDamage
// number is now just interpreted as the midpoint wherever it's read.
export const DAMAGE_ROLL_MIN_RATIO = 0.5
export const DAMAGE_ROLL_MAX_RATIO = 1.5

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
export function monsterDefense(type: EnemyTypeDef): number {
  return Math.round(type.level * 1.5)
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

// New dodge/miss-chance mechanic (confirmed with the user, 2026-07-31) — a
// player can now fully avoid an incoming monster attack, using boots' own
// dodge stat plus Agility (see derivedStats.ts). PLACEHOLDER capped-linear
// curve — 0.5% dodge chance per point, capped at 50% — unresolved/unsourced
// like the rest of this combat math, tune later. Client-only (see
// useCombatStore.runTick's monster-attack-back block) — not mirrored in
// resolve-combat, since incoming damage/player HP was never simulated
// server-side to begin with.
const DODGE_CHANCE_PER_POINT = 0.005
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
