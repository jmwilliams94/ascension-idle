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

// Corrected (2026-08-03, confirmed with the user) — supersedes the original
// "a tier only counts once BOTH its kill count is reached AND it's been paid
// for" design. Kill-count progress and paying to unlock are now two fully
// independent reward tracks, sharing the same 6 tier thresholds/magnitude
// table (still a uniform placeholder, not real per-monster content) but
// gating nothing on each other:
//   - Kill Count Reward: free, activates the moment kills reach a tier's
//     threshold, no payment involved at all.
//   - Unlock Reward: paid via unlock_next_achievement_tier, activates the
//     moment it's purchased regardless of kill count (so unlocking "ahead"
//     of your kills is no longer wasted — it's immediately live).
// Both stack multiplicatively (see totalAchievementGoldMultiplier) — mirrors
// resolve-combat/index.ts's own split, keep in sync.

// Highest kill-count tier reached (free reward), independent of unlock.
export function currentKillCountTier(kills: number): AchievementTier | null {
  let reached: AchievementTier | null = null
  for (const tier of ACHIEVEMENT_TIERS) {
    if (kills >= tier) reached = tier
  }
  return reached
}

// The next kill-count tier not yet reached — no longer restricted to
// unlocked tiers, since kill-count progress doesn't need unlocking anymore.
export function nextKillCountTier(kills: number): AchievementTier | null {
  return ACHIEVEMENT_TIERS.find((tier) => kills < tier) ?? null
}

export function killCountGoldMultiplier(kills: number): number {
  const tier = currentKillCountTier(kills)
  return tier ? ACHIEVEMENT_GOLD_MULTIPLIER[tier] : 1
}

// Highest unlock tier purchased (paid reward), independent of kill count.
export function currentUnlockTier(unlockedTierIndex: number): AchievementTier | null {
  return unlockedTierIndex > 0 ? ACHIEVEMENT_TIERS[unlockedTierIndex - 1] : null
}

export function unlockGoldMultiplier(unlockedTierIndex: number): number {
  const tier = currentUnlockTier(unlockedTierIndex)
  return tier ? ACHIEVEMENT_GOLD_MULTIPLIER[tier] : 1
}

// The real reward math resolve-combat applies — the two tracks' multipliers
// stack multiplicatively (e.g. a fully-unlocked, fully-killed monster gets
// 2x from kills * 2x from unlocks = 4x gold), matching the "unlock is a
// bonus on top of the free kill-count reward" framing confirmed with the
// user, not a replacement for it.
export function totalAchievementGoldMultiplier(kills: number, unlockedTierIndex: number): number {
  return killCountGoldMultiplier(kills) * unlockGoldMultiplier(unlockedTierIndex)
}

// The tier a character would unlock next (and its cost) — null once all 6
// are already unlocked.
export function nextTierToUnlock(unlockedTierIndex: number): { tier: AchievementTier; cost: AchievementTierCost } | null {
  const tier = ACHIEVEMENT_TIERS[unlockedTierIndex]
  return tier === undefined ? null : { tier, cost: ACHIEVEMENT_TIER_COSTS[tier] }
}
