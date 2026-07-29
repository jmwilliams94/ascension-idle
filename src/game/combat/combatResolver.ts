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

export function killRewards(type: EnemyTypeDef, isRare: boolean): { gold: number; exp: number } {
  const multiplier = isRare ? RARE_REWARD_MULTIPLIER : 1
  return { gold: type.goldReward * multiplier, exp: type.expReward * multiplier }
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
