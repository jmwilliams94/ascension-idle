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
// then pay a flat 50 Fallen Stars for the rest" gate) — every tier now costs
// something to unlock, escalating from cheap Comets up to a Fallen Star at
// the top, paid one tier at a time in order (see unlock_next_achievement_tier
// — the caller never picks which tier, only "buy the next one"). Must match
// the migration SQL's own per-tier case statement.
export interface AchievementTierCost {
  currency: 'comet' | 'fallen_star'
  amount: number
}

export const ACHIEVEMENT_TIER_COSTS: Record<AchievementTier, AchievementTierCost> = {
  100: { currency: 'comet', amount: 1 },
  250: { currency: 'comet', amount: 3 },
  500: { currency: 'comet', amount: 5 },
  1000: { currency: 'comet', amount: 10 },
  5000: { currency: 'comet', amount: 20 },
  10000: { currency: 'fallen_star', amount: 1 },
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
// bonus multiplier on the per-kill Comet/Fallen Star drop chance, scaled by
// the highest Kill Count tier reached for that monster. PLACEHOLDER
// magnitudes, same "highest tier wins, not cumulative — reaching tier 2
// overwrites tier 1's reward rather than stacking with it" shape as the gold
// table above (the user's own framing). These are the values reached only
// at the fought monster's own level 130 — see killCountBonusDropMultiplier
// below, which scales this down for lower-level monsters (corrected
// 2026-08-03, same day: without that scaling this was flat across every
// monster regardless of level, making it strictly optimal to max it out on
// the fastest-to-kill monster in the game — level-1 Quailwing — rather than
// ever fighting anything harder). The base per-kill drop chance itself
// (see combatResolver.ts's COMET_DROP_CHANCE/FALLEN_STAR_DROP_CHANCE) was
// never the problem and stays flat/untouched.
export const KILL_COUNT_BONUS_DROP_MULTIPLIER: Record<AchievementTier, number> = {
  100: 1.1,
  250: 1.25,
  500: 1.5,
  1000: 2,
  5000: 3,
  10000: 5,
}

// A monster's own level scales how much of the table above it can actually
// reach — level 1 only ever reaches MIN_LEVEL_SCALE_FRACTION (10%) of the
// full bonus even at Kill Count Tier 10000, level 130 reaches the full
// 100%. PLACEHOLDER floor/curve, deliberately not zero at level 1 so a
// low-level monster's Kill Count ladder isn't rendered completely pointless
// for this reward category, just far weaker than grinding something harder.
// Mirrors resolve-combat's own killCountBonusLevelT — keep in sync.
const MIN_LEVEL_SCALE_FRACTION = 0.1
const MAX_MONSTER_LEVEL_FOR_BONUS_SCALING = 130

function killCountBonusLevelT(monsterLevel: number): number {
  const raw = (monsterLevel - 1) / (MAX_MONSTER_LEVEL_FOR_BONUS_SCALING - 1)
  return MIN_LEVEL_SCALE_FRACTION + (1 - MIN_LEVEL_SCALE_FRACTION) * Math.min(Math.max(raw, 0), 1)
}

// The bonus a specific tier would give for a specific monster's level —
// used both for "what would tier N give me on this monster" tooltip text
// and (via killCountBonusDropMultiplier below) for "what's currently active."
export function killCountBonusMultiplierAtTier(tier: AchievementTier, monsterLevel: number): number {
  return 1 + (KILL_COUNT_BONUS_DROP_MULTIPLIER[tier] - 1) * killCountBonusLevelT(monsterLevel)
}

// Confirmed, not a placeholder — 1/25000 chance per kill (lowered from the
// original 1/5000, 2026-08-03, per the user — that rate felt too common),
// independent of every other roll combat makes, account-wide one-shot
// unlock per monster.
export const PET_DROP_CHANCE = 1 / 25000

// Zone-level Achievements layer (2026-08-03, confirmed with the user) —
// ADDITIVE to the per-monster system above, not a replacement (an earlier
// draft of this feature wrongly assumed replacement before the user
// corrected it). Every zone has exactly 5 monsters (see zoneData.ts), so 5
// monsters x 6 tiers = 30 possible tier-milestones per zone, uniformly — a
// character's zone total is "how many of those 30 has this character
// reached across the zone's whole roster so far" (e.g. "3/30 tiers
// completed"), independent of which specific monster they came from. This
// even 6-step ladder (5/10/15/20/25/30) mirrors every other tier system in
// this game. Reward is a Fallen Star grant per zone tier, PLACEHOLDER,
// escalating — "gives you a Fallen Star or something," per the user's own
// framing. The actual grant only ever happens server-side (resolve-combat,
// tracked via character_zone_progress so it's not re-granted) — these
// constants exist client-side purely to drive the live display, computed
// straight from useAchievementsStore's already-loaded characterKills, no
// separate fetch needed.
export const ZONE_MONSTER_COUNT = 5
export const ZONE_TOTAL_TIER_MILESTONES = ZONE_MONSTER_COUNT * ACHIEVEMENT_TIERS.length
export const ZONE_TIER_COMPLETIONS = [5, 10, 15, 20, 25, 30] as const
export const ZONE_TIER_FALLEN_STAR_REWARD = [1, 2, 3, 4, 5, 8] as const

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

export function killCountBonusDropMultiplier(kills: number, monsterLevel: number): number {
  const tier = currentKillCountTier(kills)
  return tier ? killCountBonusMultiplierAtTier(tier, monsterLevel) : 1
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
