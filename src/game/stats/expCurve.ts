// Pure EXP-curve module, split out of useProgressionStore.ts (2026-08-05) so
// combatResolver.ts (a pure, store-free module) can compute monster EXP
// rewards directly from this same curve without importing the whole
// Zustand store. useProgressionStore.ts re-exports MAX_CHARACTER_LEVEL/
// requiredExpForLevel from here for backward compatibility — no external
// caller needs to change its import.

// Real level cap, confirmed by the user (2026-07-30) alongside the EXP curve
// below — matches the gear system's own 130 weapon-level cap (see CLAUDE.md).
export const MAX_CHARACTER_LEVEL = 130

// Real Conquer Online EXP-curve reference data (confirmed 2026-07-30) — the
// per-level EXP required to advance from that level to the next, at a handful
// of confirmed anchor levels (total EXP to reach 130 from level 1 sums to
// ~13.4 billion, matching the source). Levels between anchors don't have
// confirmed numbers, so they're geometrically interpolated (proportional on a
// log scale between the two nearest anchors) rather than guessed — an honest
// curve through real data beats inventing a smooth formula that doesn't
// actually match any of the confirmed points. The steep jump from level 109 to
// 110 lines up with a promotion-tier boundary (see the Promotion tiers note in
// CLAUDE.md), not a data error. Levels 128-130 plateau at the same value,
// matching the source noting 130's requirement is identical to 128's.
const EXP_CURVE_ANCHORS: [level: number, required: number][] = [
  [1, 39],
  [20, 68_789],
  [21, 70_451],
  [80, 15_896_985],
  [81, 16_163_738],
  [109, 193_716_061],
  [110, 408_832_135],
  [127, 1_011_439_064],
  [128, 1_073_741_808],
  [MAX_CHARACTER_LEVEL, 1_073_741_808],
]

export function requiredExpForLevel(level: number): number {
  const clampedLevel = Math.min(Math.max(level, 1), MAX_CHARACTER_LEVEL)

  for (let i = 0; i < EXP_CURVE_ANCHORS.length; i += 1) {
    const [anchorLevel, anchorValue] = EXP_CURVE_ANCHORS[i]

    if (clampedLevel === anchorLevel) {
      return anchorValue
    }

    if (clampedLevel < anchorLevel) {
      const [prevLevel, prevValue] = EXP_CURVE_ANCHORS[i - 1]
      const t = (clampedLevel - prevLevel) / (anchorLevel - prevLevel)
      return Math.round(prevValue * (anchorValue / prevValue) ** t)
    }
  }

  return EXP_CURVE_ANCHORS[EXP_CURVE_ANCHORS.length - 1][1]
}

// Monster EXP reward — recalibrated 2026-08-05 (confirmed with the user,
// reported as "the entire week I've only gotten to level 23"). Previously a
// hand-placed, roughly-linear-with-level field on each EnemyTypeDef (5 EXP at
// level 1 up to 110 EXP at level 129, a ~22x range) while requiredExpForLevel
// above grows ~27,000,000x over the same range (39 to 1.07 billion) — since
// kill rate is roughly constant across the whole level range (monster HP and
// player damage were both designed to scale together, ~3 hits/kill at 1
// attack/sec throughout, per zoneData.ts's own "tied to the bow power curve"
// convention), that mismatch compounds into a genuine wall: level 80 alone
// needed ~241 hours of continuous same-level fighting under the old numbers,
// level 110 needed ~3,960. Formula-derived now instead (same "don't hand-place
// a stat that can be computed from level" convention as monsterDefense/
// monsterDodge below) so the reward curve moves in lockstep with the required
// curve.
//
// Deliberately NOT a single flat rate throughout (an earlier same-day pass
// used one constant kills-per-level everywhere and the user corrected it —
// "it should feel harder as you level up, I don't want every level to be 30
// mins"): kills-per-level instead steps up at each of this game's own
// confirmed promotion tiers (1/15/40/70/100/110/120 — see CLAUDE.md's
// Progression section), so the grind genuinely escalates at each promotion
// rather than staying constant or exploding.
//
// Retuned again the same day (still 2026-08-05) — the first version of this
// table (200/320/500/800/1250/2000/3200, ~1.5-1.6x per tier) was still "a
// little fast" per the user, who specifically wanted later levels to *take
// longer* (steeper tier-to-tier jumps), not just a uniform slowdown, and
// early levels left close to where they already were. This version escalates
// ~1.75-2x per tier instead: roughly 10 min/level at the very start, ~32
// min/level by tier 3 (level 40+), up to ~8.3 hours/level in the endgame
// (tier 7, level 120+) — ~215 hours of active kill-time for the full 1-130
// run (before the idle-rate split further adjusts the *effective* time).
// PLACEHOLDER table, same disclosed-not-final status as every other economy
// number in this combat system. Doesn't account for the White/Green/Red/
// Black level-diff EXP multiplier (expMultiplierForLevelDiff in
// combatResolver.ts), which still applies on top of this unchanged.
//
// Recalibrated again 2026-11 (reported by the user: leveling had gone from
// "grindy" to a wall after that same 2026-11 weapon-curve/enemy-HP/respawn-gap
// rebalance) — this table's ~10-min/level-early to ~8.3-hr/level-endgame
// pacing was calibrated against a per-kill cycle of ~3s (no respawn gap, ~3
// hits/kill) and a per-kill EXP grant of 150% of expRewardForLevel (the full
// on-kill grant plus the now-removed +50% damage-dealt bonus). Both of those
// assumptions are gone: RESPAWN_GAP_MS is now 10s and dominates the cycle
// time for every realistic gear tier (even Normal-quality's ~9 hits/kill
// finishes in under 10s, so the fixed gap — not fight length — sets the real
// kill rate), and damage-dealt EXP was removed (on-kill grant only, 100% not
// 150%). Net effect: real EXP/hour fell to (1.0/10s) / (1.5/3s) = 20% of the
// pacing this table was built for, a hidden 5x slowdown nothing here
// compensated for. Every value below divided by 5 (200/350/650/1300/2600/
// 5200/10000 → 40/70/130/260/520/1040/2000) to restore the originally-stated
// real-time-per-level pacing under the new 10s-gap-dominated cycle. Must stay
// in sync with the mirrored copy in resolve-combat/index.ts.
const PROMOTION_TIER_ANCHORS = [1, 15, 40, 70, 100, 110, 120]
const KILLS_PER_LEVEL_BY_TIER = [40, 70, 130, 260, 520, 1040, 2000]

function killsPerLevelForLevel(level: number): number {
  let tierIndex = 0
  for (let i = 0; i < PROMOTION_TIER_ANCHORS.length; i += 1) {
    if (level >= PROMOTION_TIER_ANCHORS[i]) {
      tierIndex = i
    }
  }
  return KILLS_PER_LEVEL_BY_TIER[tierIndex]
}

export function expRewardForLevel(level: number): number {
  return Math.max(1, Math.round(requiredExpForLevel(level) / killsPerLevelForLevel(level)))
}

