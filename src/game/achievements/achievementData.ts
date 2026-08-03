// Achievements & Pets (confirmed shape, see CLAUDE.md's Achievements & Pets
// section). This file mirrors the same constants in
// supabase/functions/resolve-combat/index.ts — keep in sync, same "must stay
// in sync" convention as every other combat-math constant shared between
// client and server in this codebase.
//
// The tracking MECHANISM here is real; the reward VALUES are a deliberate
// uniform placeholder applied identically to every monster/zone, since the
// actual per-monster/per-tier rewards are explicitly not decided yet ("we'll
// have to think of what we want... not a formula to invent" — see
// CLAUDE.md). Treat every multiplier/reward table below as a placeholder,
// not final content.

export const ACHIEVEMENT_TIERS = [100, 250, 500, 1000, 5000, 10000] as const
export type AchievementTier = (typeof ACHIEVEMENT_TIERS)[number]

// A monster's Kill Count must reach this (Tier 1) before Prestige can start
// advancing at all — "to proceed to the next Prestige you need to complete
// the 1st round of Kill Count" (confirmed with the user, 2026-08-03). A
// one-time gate, not a per-tier parallel requirement: kills only ever go up,
// so once true it stays true for every later Prestige purchase regardless of
// which tier. Mirrors unlock_next_achievement_tier's own `v_kills < 100` check.
export const MIN_KILLS_FOR_PRESTIGE = ACHIEVEMENT_TIERS[0]

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

// Corrected (2026-08-03, confirmed with the user) — supersedes the earlier
// "Kill Count and Prestige both grant gold, stacking multiplicatively"
// design. "Unlocks" is renamed **Prestige** everywhere (wording only, same
// unlocked_tier_index column/RPC) and now solely owns the yield/kill-rate
// reward category — this is the only gold multiplier left. Kill Count's own
// reward moved to a separate, non-gold category ("other bonuses," per the
// user's own framing) — see KILL_COUNT_BONUS_DROP_MULTIPLIER below. Same
// table reused for both (PLACEHOLDER, highest tier reached wins, not
// cumulative) since both still escalate across the same 6 tiers uniformly.
export const ACHIEVEMENT_GOLD_MULTIPLIER: Record<AchievementTier, number> = {
  100: 1.05,
  250: 1.1,
  500: 1.2,
  1000: 1.35,
  5000: 1.5,
  10000: 2,
}

// Kill Count's own reward category (2026-08-03, confirmed with the user) — a
// bonus multiplier on the per-kill Meteor/DragonBall drop chance, scaled by
// the highest Kill Count tier reached for that monster. PLACEHOLDER
// magnitudes, same "highest tier wins, not cumulative — reaching tier 2
// overwrites tier 1's reward rather than stacking with it" shape as the gold
// table above (the user's own framing).
export const KILL_COUNT_BONUS_DROP_MULTIPLIER: Record<AchievementTier, number> = {
  100: 1.1,
  250: 1.25,
  500: 1.5,
  1000: 2,
  5000: 3,
  10000: 5,
}

// Confirmed, not a placeholder — 1/5000 chance per kill, independent of every
// other roll combat makes, account-wide one-shot unlock per monster.
export const PET_DROP_CHANCE = 1 / 5000

// Zone-level Achievements layer (2026-08-03, confirmed with the user) —
// ADDITIVE to the per-monster system above, not a replacement (an earlier
// draft of this feature wrongly assumed replacement before the user
// corrected it). Every zone has exactly 5 monsters (see zoneData.ts), so 5
// monsters x 6 tiers = 30 possible tier-milestones per zone, uniformly — a
// character's zone total is "how many of those 30 has this character
// reached across the zone's whole roster so far" (e.g. "3/30 tiers
// completed"), independent of which specific monster they came from. This
// even 6-step ladder (5/10/15/20/25/30) mirrors every other tier system in
// this game. Reward is a DragonBall grant per zone tier, PLACEHOLDER,
// escalating — "gives you a DragonBall or something," per the user's own
// framing. The actual grant only ever happens server-side (resolve-combat,
// tracked via character_zone_progress so it's not re-granted) — these
// constants exist client-side purely to drive the live display, computed
// straight from useAchievementsStore's already-loaded characterKills, no
// separate fetch needed.
export const ZONE_MONSTER_COUNT = 5
export const ZONE_TOTAL_TIER_MILESTONES = ZONE_MONSTER_COUNT * ACHIEVEMENT_TIERS.length
export const ZONE_TIER_COMPLETIONS = [5, 10, 15, 20, 25, 30] as const
export const ZONE_TIER_DRAGONBALL_REWARD = [1, 2, 3, 4, 5, 8] as const

// Highest Kill Count tier reached for one monster (its own reward — a bonus
// to currency-drop chance, see KILL_COUNT_BONUS_DROP_MULTIPLIER), unrelated
// to Prestige.
export function currentKillCountTier(kills: number): AchievementTier | null {
  let reached: AchievementTier | null = null
  for (const tier of ACHIEVEMENT_TIERS) {
    if (kills >= tier) reached = tier
  }
  return reached
}

// The next Kill Count tier not yet reached for one monster.
export function nextKillCountTier(kills: number): AchievementTier | null {
  return ACHIEVEMENT_TIERS.find((tier) => kills < tier) ?? null
}

export function killCountBonusDropMultiplier(kills: number): number {
  const tier = currentKillCountTier(kills)
  return tier ? KILL_COUNT_BONUS_DROP_MULTIPLIER[tier] : 1
}

// Highest Prestige tier purchased for one monster (paid, via
// unlock_next_achievement_tier) — the sole source of that monster's gold
// multiplier now.
export function currentPrestigeTier(unlockedTierIndex: number): AchievementTier | null {
  return unlockedTierIndex > 0 ? ACHIEVEMENT_TIERS[unlockedTierIndex - 1] : null
}

export function prestigeGoldMultiplier(unlockedTierIndex: number): number {
  const tier = currentPrestigeTier(unlockedTierIndex)
  return tier ? ACHIEVEMENT_GOLD_MULTIPLIER[tier] : 1
}

// The tier a character would unlock (Prestige) next for one monster, and its
// cost — null once all 6 are already unlocked. Does not itself check the
// MIN_KILLS_FOR_PRESTIGE gate — callers show that as a separate reason when
// blocking the purchase, same as the currency-affordability check.
export function nextTierToUnlock(unlockedTierIndex: number): { tier: AchievementTier; cost: AchievementTierCost } | null {
  const tier = ACHIEVEMENT_TIERS[unlockedTierIndex]
  return tier === undefined ? null : { tier, cost: ACHIEVEMENT_TIER_COSTS[tier] }
}

// How many of a zone's 30 possible tier-milestones a set of per-monster kill
// counts has reached in total, and which zone tier (0-6) that maps to.
// Mirrors resolve-combat's own zoneTierCompletions — keep in sync. Purely a
// display computation client-side (the real grant is server-only).
export function zoneTierCompletions(zoneMonsterKills: number[]): { completions: number; zoneTier: number } {
  let completions = 0
  for (const kills of zoneMonsterKills) {
    for (const tier of ACHIEVEMENT_TIERS) {
      if (kills >= tier) completions += 1
    }
  }
  let zoneTier = 0
  for (const threshold of ZONE_TIER_COMPLETIONS) {
    if (completions >= threshold) zoneTier += 1
  }
  return { completions, zoneTier }
}
