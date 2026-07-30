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

// Meteor/Dragonball kill-drop odds — confirmed by the user (2026-07-30), not a
// placeholder like the rest of this file's numbers. Independent per-kill rolls,
// not affected by rare status (rare only multiplies HP/gold/EXP per the
// existing confirmed design above). Shared by live combat and the offline
// simulator so odds can never drift between the two, same convention as every
// other roll in this module.
export const METEOR_DROP_CHANCE = 1 / 500
export const DRAGONBALL_DROP_CHANCE = 1 / 20000

export function rollBonusCurrencyDrops(): { meteors: number; dragonballs: number } {
  return {
    meteors: Math.random() < METEOR_DROP_CHANCE ? 1 : 0,
    dragonballs: Math.random() < DRAGONBALL_DROP_CHANCE ? 1 : 0,
  }
}

// PLACEHOLDER monster attack cadence — fixed at once per second, not derived
// from any per-monster "attack speed" concept (none exists yet, unlike the
// player's own derived.attackSpeed).
export const MONSTER_ATTACK_INTERVAL_MS = 1000

// Rare status only affects HP/rewards per CLAUDE.md's confirmed design (2x HP,
// 5x gold/EXP) — deliberately not a harder-hitting monster, so this ignores
// isRare unlike spawnMonsterHp/killRewards above.
export function monsterAttackDamage(type: EnemyTypeDef): number {
  return type.attackDamage
}
