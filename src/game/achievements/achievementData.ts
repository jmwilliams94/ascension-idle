// Achievements & Pets, Stage 1 (confirmed shape, see CLAUDE.md's Achievements &
// Pets section — added from a mobile session). This file mirrors the same
// constants in supabase/functions/resolve-combat/index.ts — keep in sync, same
// "must stay in sync" convention as every other combat-math constant shared
// between client and server in this codebase.
//
// The tracking MECHANISM here is real; the reward VALUES are a deliberate
// uniform placeholder applied identically to every monster, since the actual
// per-monster/per-tier rewards are explicitly not decided yet ("we'll have to
// think of what we want... not a formula to invent" — see CLAUDE.md). Treat
// ACHIEVEMENT_GOLD_MULTIPLIER as a placeholder, not final content.

export const ACHIEVEMENT_TIERS = [100, 250, 500, 1000, 5000, 10000] as const
export type AchievementTier = (typeof ACHIEVEMENT_TIERS)[number]

// Confirmed with the user (2026-08-01, supersedes the original "first 3 free,
// then pay a flat 50 DragonBalls for the rest" gate) — every tier now costs
// something to unlock, escalating from cheap Meteors up to a DragonBall at
// the top, paid one tier at a time in order (see unlock_next_achievement_tier
// — the caller never picks which tier, only "buy the next one"). Must match
// the migration SQL's own per-tier case statement.
export interface AchievementTierCost {
  currency: 'meteor' | 'dragonball'
  amount: number
}

export const ACHIEVEMENT_TIER_COSTS: Record<AchievementTier, AchievementTierCost> = {
  100: { currency: 'meteor', amount: 1 },
  250: { currency: 'meteor', amount: 3 },
  500: { currency: 'meteor', amount: 5 },
  1000: { currency: 'meteor', amount: 10 },
  5000: { currency: 'meteor', amount: 20 },
  10000: { currency: 'dragonball', amount: 1 },
}

// PLACEHOLDER gold multiplier per tier, uniform across every monster — highest
// tier reached wins, not cumulative/stacking. Real per-monster tier rewards
// (and the account-wide ladder's own, deliberately different reward
// category) are unresolved per CLAUDE.md — do not treat these as final.
export const ACHIEVEMENT_GOLD_MULTIPLIER: Record<AchievementTier, number> = {
  100: 1.05,
  250: 1.1,
  500: 1.2,
  1000: 1.35,
  5000: 1.5,
  10000: 2,
}

// Confirmed, not a placeholder — 1/5000 chance per kill, independent of every
// other roll combat makes, account-wide one-shot unlock per monster.
export const PET_DROP_CHANCE = 1 / 5000

// A tier only actually counts (toward the multiplier, or toward "next tier"
// progress) once BOTH its kill count is reached AND it's been paid for —
// unlockedTierIndex counts how many of the 6 tiers, in order, have been
// unlocked so far (0 = none, 6 = all).
function eligibleTiers(unlockedTierIndex: number): readonly AchievementTier[] {
  return ACHIEVEMENT_TIERS.slice(0, unlockedTierIndex)
}

// The next tier a given kill count hasn't reached yet, among unlocked tiers
// only — used by AchievementsPanel to show "N / nextTier" progress. Returns
// null once every unlocked tier has been reached (whether or not further
// tiers exist — those need unlocking first, see nextTierToUnlock below).
export function nextAchievementTier(kills: number, unlockedTierIndex: number): AchievementTier | null {
  return eligibleTiers(unlockedTierIndex).find((tier) => kills < tier) ?? null
}

// The highest tier a kill count has actually reached AND unlocked (or null if
// none yet) — mirrors resolve-combat's own currentAchievementGoldMultiplier
// logic, used here to show which multiplier is currently active.
export function currentAchievementTier(kills: number, unlockedTierIndex: number): AchievementTier | null {
  let reached: AchievementTier | null = null
  for (const tier of eligibleTiers(unlockedTierIndex)) {
    if (kills >= tier) {
      reached = tier
    }
  }
  return reached
}

// The tier a character would unlock next (and its cost) — null once all 6
// are already unlocked.
export function nextTierToUnlock(unlockedTierIndex: number): { tier: AchievementTier; cost: AchievementTierCost } | null {
  const tier = ACHIEVEMENT_TIERS[unlockedTierIndex]
  return tier === undefined ? null : { tier, cost: ACHIEVEMENT_TIER_COSTS[tier] }
}
