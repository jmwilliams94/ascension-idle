// Achievements & Pets (see CLAUDE.md's Achievements & Pets section for the
// full history). This file mirrors the same constants in
// supabase/functions/resolve-combat/index.ts and
// supabase/migrations/20260806000000_achievements_rework.sql — keep in sync,
// same "must stay in sync" convention as every other combat-math constant
// shared between client and server in this codebase.
//
// Reworked (2026-08-06, confirmed with the user) — collapses the old
// dual-track system (an always-on Kill Count bonus-drop multiplier + a paid
// Prestige gold multiplier) into a single Kill Count ladder per monster
// where each of the 6 tiers is a one-time CLAIM (not an automatic
// multiplier), and gives the account-wide ladder (kills summed across all 5
// character slots) its own reward category: small, permanent account-wide
// combat buffs. Prestige is removed entirely.
//
// Reward VALUES below are a deliberate placeholder, same disclosed-not-final
// status as every other economy number in this game — "have placeholder
// rewards for everything... nothing should be a crazy high percentage buff,
// they should all be small slight increases," per the user's own explicit
// instruction.

export const ACHIEVEMENT_TIERS = [100, 250, 500, 1000, 5000, 10000] as const
export type AchievementTier = (typeof ACHIEVEMENT_TIERS)[number]

// 5x the character track's own thresholds (confirmed with the user: "since
// we will have 5 character slots, I want the account rewards to be 5x
// whatever the character requirement is").
export const ACCOUNT_TIER_THRESHOLDS = [500, 1250, 2500, 5000, 25000, 50000] as const

// Confirmed, not a placeholder — 1/25000 chance per kill (lowered from the
// original 1/5000, 2026-08-03, per the user — that rate felt too common),
// independent of every other roll combat makes, account-wide one-shot
// unlock per monster.
export const PET_DROP_CHANCE = 1 / 25000

// Zone-level Achievements layer (2026-08-03, confirmed with the user) —
// ADDITIVE to the per-monster system above, not a replacement. Every zone has
// exactly 5 monsters (see zoneData.ts), so 5 monsters x 6 tiers = 30 possible
// tier-milestones per zone, uniformly — a character's zone total is "how
// many of those 30 has this character reached across the zone's whole
// roster so far" (e.g. "3/30 tiers completed"), independent of which
// specific monster they came from. This even 6-step ladder (5/10/15/20/25/30)
// mirrors every other tier system in this game. Reward is a Fallen Star
// grant per zone tier, PLACEHOLDER, escalating. The actual grant only ever
// happens server-side (resolve-combat, tracked via character_zone_progress
// so it's not re-granted) — these constants exist client-side purely to
// drive the live display, computed straight from useAchievementsStore's
// already-loaded characterKills, no separate fetch needed. Unaffected by
// this rework.
export const ZONE_MONSTER_COUNT = 5
export const ZONE_TOTAL_TIER_MILESTONES = ZONE_MONSTER_COUNT * ACHIEVEMENT_TIERS.length
export const ZONE_TIER_COMPLETIONS = [5, 10, 15, 20, 25, 30] as const
export const ZONE_TIER_FALLEN_STAR_REWARD = [1, 2, 3, 4, 5, 8] as const

// ----------------------------------------------------------------------------
// Character track — one-time claims, tiers 1-6 (matches
// character_monster_kills.claimed_tier_index, 0 = nothing claimed yet).
// Tiers 1-4 grant a small Comet/Lottery-Ticket bundle; tier 5 grants the
// single, sole Fallen Star reward ("Fallen stars as a reward should be
// extremely rare final tier kind of reward" — confirmed with the user, no
// other tier ever grants one); tier 6 grants a real Infused-quality gear
// item, picked the same "random class-appropriate family, nearest level to
// the monster" way an ordinary kill-drop already is (see
// pick_infused_reward_template in the migration) — generalizes the old
// Windhollow-only MONSTER_GEAR_REWARDS special case to every monster.
// ----------------------------------------------------------------------------
export interface CharacterTierReward {
  comets?: number
  fallenStars?: number
  lotteryTickets?: number
  infusedGear?: boolean
}

// Indexed 0-5, i.e. CHARACTER_TIER_REWARDS[tierIndex - 1] for 1-based tier
// index N. Must match claim_kill_count_reward's own case statement exactly.
export const CHARACTER_TIER_REWARDS: readonly CharacterTierReward[] = [
  { comets: 2 },
  { comets: 3 },
  { lotteryTickets: 1 },
  { comets: 5, lotteryTickets: 1 },
  { fallenStars: 1 },
  { infusedGear: true },
]

export function describeCharacterTierReward(reward: CharacterTierReward): string {
  const parts: string[] = []
  if (reward.comets) parts.push(`+${reward.comets} Comet${reward.comets > 1 ? 's' : ''}`)
  // No "+N" prefix for Lottery Ticket specifically (unlike the count-based
  // currencies above) — confirmed with the user, 2026-08-06: it reads as a
  // single item, not a stackable amount, so "Lottery Ticket" (or "Lottery
  // Tickets" if a future tier ever grants more than one) is the natural
  // phrasing rather than "+1 Lottery Ticket".
  if (reward.lotteryTickets) parts.push(reward.lotteryTickets > 1 ? `${reward.lotteryTickets} Lottery Tickets` : 'Lottery Ticket')
  if (reward.fallenStars) parts.push(`+${reward.fallenStars} Fallen Star${reward.fallenStars > 1 ? 's' : ''}`)
  if (reward.infusedGear) parts.push('1 Infused gear item')
  return parts.join(' + ')
}

// ----------------------------------------------------------------------------
// Account track — one-time claims, tiers 1-6 (matches
// account_monster_kills.claimed_tier_index). Each claim adds a small,
// permanent bump to players.account_attack_bonus_pct/account_drop_bonus_pct,
// cumulative across every monster's own account-tier claims (not
// highest-wins like the old Prestige gold multiplier was) — the user's own
// framing for why: "so the next time round when you go to level a character
// and have to kill the low level mobs again, it's easier and with better
// rewards."
// ----------------------------------------------------------------------------
export interface AccountTierReward {
  attackBonusPct: number
  dropBonusPct: number
}

// Indexed 0-5, i.e. ACCOUNT_TIER_REWARDS[tierIndex - 1] for 1-based tier
// index N. Must match claim_account_achievement_reward's own case statement
// exactly. Summed across all 40 monsters at full completion this totals
// roughly +50% attack / +42% drop — a genuine long-term account-wide
// investment without any single claim ever being "a crazy high percentage
// buff."
export const ACCOUNT_TIER_REWARDS: readonly AccountTierReward[] = [
  { attackBonusPct: 0.05, dropBonusPct: 0.05 },
  { attackBonusPct: 0.08, dropBonusPct: 0.08 },
  { attackBonusPct: 0.12, dropBonusPct: 0.12 },
  { attackBonusPct: 0.2, dropBonusPct: 0.15 },
  { attackBonusPct: 0.3, dropBonusPct: 0.25 },
  { attackBonusPct: 0.5, dropBonusPct: 0.4 },
]

export function describeAccountTierReward(reward: AccountTierReward): string {
  return `+${(reward.attackBonusPct * 100).toFixed(0)}% Attack, +${(reward.dropBonusPct * 100).toFixed(0)}% Drop Chance`
}

// ----------------------------------------------------------------------------
// Shared tier-progress helpers — used for both tracks, parametrized by
// whichever threshold list applies.
// ----------------------------------------------------------------------------

// How many tiers (0-6) a kill count has reached against a given threshold
// list — the ladder position BEFORE accounting for what's actually been
// claimed yet (claimed_tier_index is tracked separately, server-side).
export function tierIndexReached(kills: number, thresholds: readonly number[]): number {
  let reached = 0
  for (let i = 0; i < thresholds.length; i += 1) {
    if (kills >= thresholds[i]) reached = i + 1
  }
  return reached
}

export function characterTierIndexReached(kills: number): number {
  return tierIndexReached(kills, ACHIEVEMENT_TIERS)
}

export function accountTierIndexReached(kills: number): number {
  return tierIndexReached(kills, ACCOUNT_TIER_THRESHOLDS)
}

// Highest Kill Count tier reached for one monster (display only — whether
// it's actually been claimed is a separate, server-tracked fact).
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
