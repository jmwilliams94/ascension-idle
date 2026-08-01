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
// ACHIEVEMENT_GOLD_MULTIPLIER and ACHIEVEMENT_TIER2_COST as placeholders,
// not final content.

export const ACHIEVEMENT_TIERS = [100, 250, 500, 1000, 5000, 10000] as const
export type AchievementTier = (typeof ACHIEVEMENT_TIERS)[number]

// Tiers 1000/5000/10000 only apply once a character has paid to unlock them
// for that specific monster (see unlock_achievement_tier2) — the free ladder
// tops out at 500.
export const FREE_ACHIEVEMENT_TIERS: readonly AchievementTier[] = ACHIEVEMENT_TIERS.filter((tier) => tier <= 500)
export const UPGRADED_ACHIEVEMENT_TIERS: readonly AchievementTier[] = ACHIEVEMENT_TIERS.filter((tier) => tier > 500)

// PLACEHOLDER — a flat DragonBall cost to unlock the 1000/5000/10000 tier set
// for one character's kill count on one monster. Must match
// unlock_achievement_tier2's own v_cost in the migration SQL.
export const ACHIEVEMENT_TIER2_COST = 50

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

// The next tier a given kill count hasn't reached yet, respecting whether
// tier2 is unlocked — used by AchievementsPanel to show "N / nextTier"
// progress. Returns null once every eligible tier has been reached.
export function nextAchievementTier(kills: number, tier2Unlocked: boolean): AchievementTier | null {
  const eligibleTiers = tier2Unlocked ? ACHIEVEMENT_TIERS : FREE_ACHIEVEMENT_TIERS
  return eligibleTiers.find((tier) => kills < tier) ?? null
}

// The highest tier a kill count has actually reached (or null if none yet) —
// mirrors resolve-combat's own currentAchievementGoldMultiplier logic, used
// here to show which multiplier is currently active.
export function currentAchievementTier(kills: number, tier2Unlocked: boolean): AchievementTier | null {
  const eligibleTiers = tier2Unlocked ? ACHIEVEMENT_TIERS : FREE_ACHIEVEMENT_TIERS
  let reached: AchievementTier | null = null
  for (const tier of eligibleTiers) {
    if (kills >= tier) {
      reached = tier
    }
  }
  return reached
}
