// Server-authoritative combat resolution — see CLAUDE.md's Loot section and
// the plan this was built from. Replaces the old client-trusted model where
// gold/EXP were locally incremented (autosaved) and item drops were a direct
// client-side `insert` into item_instances (the real hole this closes — a
// modified client could insert any template/quality/level it wanted).
//
// Invoked via `supabase.functions.invoke('resolve-combat', { body: { characterId } })`
// from both live combat (a periodic ~15s background call, see CombatEngine.tsx)
// and the offline-progress check at login (see offlineProgress.ts) — one
// server-side code path decides the real economy state either way, rather than
// two parallel client-side resolvers that used to have to be kept in sync.
//
// KNOWN DUPLICATION, ACCEPTED: the math below (HP/reward scaling, the EXP
// curve, the simplified Attack-vs-Defense damage formula, Comet/Fallen Star
// odds) mirrors src/game/combat/combatResolver.ts and
// src/game/stats/{derivedStats,classes,useProgressionStore}.ts and
// src/game/items/equipmentBonus.ts almost line-for-line. Deno can't cleanly
// import those files directly (they're resolved by Vite without file
// extensions, which Deno's module resolution doesn't do) without an import
// map, so this is a deliberate, disclosed copy — the same "must stay in sync"
// relationship this codebase already has elsewhere (e.g. forgeCosts.ts's
// preview functions vs. their SQL counterparts). If any of those formulas
// change, mirror the change here too.
//
// Gold/EXP/kill-count reward math (2026-08-11 rewrite, see CLAUDE.md's
// Combat section) is deterministic closed-form math now, not per-attack RNG
// simulation — this is what lets the client's own live prediction match
// this function's confirmed result almost exactly, rather than the two
// independently rolling hit/dodge/rare/damage-in-range and disagreeing by a
// kill or two most windows. Item/currency/pet drops and the rare-monster
// visual flavor still roll real RNG server-side — see the reward-math block
// itself for which quantities are which.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// Explicitly set via `supabase secrets set SERVICE_ROLE_KEY=...` (see the
// deploy note in CLAUDE.md) rather than relying on the auto-injected
// SUPABASE_SERVICE_ROLE_KEY — on a project using the newer publishable/secret
// API key system, that auto-injected value may not be the currently-active
// key, causing every query here to silently run under-privileged instead of
// as a genuine service role.
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

// ---------------------------------------------------------------------------
// Mirrors src/game/stats/classes.ts's ATTRIBUTE_ANCHORS/getAttributesForLevel
// — attributes are a pure function of (class, level) via auto-allotment
// (confirmed with the user, 2026-08-02), not a flat per-class constant
// anymore. See classes.ts for the full sourcing writeup/caveats. Computed
// once per resolve call from the character's level as of the start of the
// window (same "fixed for the whole window" simplification already used for
// the level-diff EXP multiplier and the achievement gold multiplier below —
// a level-up mid-window doesn't retroactively boost that window's own
// attack output).
// ---------------------------------------------------------------------------
interface Attributes {
  strength: number
  agility: number
  vitality: number
  spirit: number
}

type AttributeAnchor = [level: number, attrs: Attributes]

const WARRIOR_TROJAN_SHARED_ANCHORS: AttributeAnchor[] = [
  [1, { strength: 5, agility: 2, vitality: 3, spirit: 0 }],
  [15, { strength: 28, agility: 10, vitality: 14, spirit: 0 }],
]

const ATTRIBUTE_ANCHORS: Record<string, AttributeAnchor[]> = {
  juggernaut: [
    ...WARRIOR_TROJAN_SHARED_ANCHORS,
    [40, { strength: 80, agility: 25, vitality: 22, spirit: 0 }],
    [70, { strength: 140, agility: 45, vitality: 32, spirit: 0 }],
    [100, { strength: 205, agility: 60, vitality: 42, spirit: 0 }],
    [110, { strength: 225, agility: 65, vitality: 47, spirit: 0 }],
    [120, { strength: 245, agility: 70, vitality: 52, spirit: 0 }],
    [130, { strength: 265, agility: 75, vitality: 57, spirit: 0 }],
  ],
  'twin-soul': [
    ...WARRIOR_TROJAN_SHARED_ANCHORS,
    [40, { strength: 60, agility: 25, vitality: 25, spirit: 0 }],
    [70, { strength: 110, agility: 42, vitality: 45, spirit: 0 }],
    [100, { strength: 155, agility: 60, vitality: 92, spirit: 0 }],
    [110, { strength: 170, agility: 65, vitality: 100, spirit: 0 }],
    [120, { strength: 185, agility: 70, vitality: 108, spirit: 0 }],
    [130, { strength: 200, agility: 75, vitality: 116, spirit: 0 }],
  ],
  wuxia: [
    [1, { strength: 0, agility: 2, vitality: 3, spirit: 5 }],
    [15, { strength: 0, agility: 10, vitality: 17, spirit: 25 }],
    [40, { strength: 0, agility: 25, vitality: 22, spirit: 80 }],
    [70, { strength: 0, agility: 45, vitality: 32, spirit: 140 }],
    [100, { strength: 0, agility: 60, vitality: 42, spirit: 205 }],
    [110, { strength: 0, agility: 65, vitality: 47, spirit: 225 }],
    [120, { strength: 0, agility: 70, vitality: 52, spirit: 245 }],
    [130, { strength: 0, agility: 75, vitality: 57, spirit: 265 }],
  ],
  hunter: [
    [1, { strength: 3, agility: 5, vitality: 2, spirit: 0 }],
    [15, { strength: 12, agility: 30, vitality: 5, spirit: 0 }],
    [40, { strength: 25, agility: 90, vitality: 12, spirit: 0 }],
    [70, { strength: 45, agility: 150, vitality: 22, spirit: 0 }],
    [100, { strength: 60, agility: 215, vitality: 32, spirit: 0 }],
    [110, { strength: 68, agility: 235, vitality: 34, spirit: 0 }],
    [120, { strength: 76, agility: 255, vitality: 36, spirit: 0 }],
    [130, { strength: 84, agility: 275, vitality: 38, spirit: 0 }],
  ],
}

function getAttributesForLevel(classId: string, level: number): Attributes {
  const anchors = ATTRIBUTE_ANCHORS[classId] ?? ATTRIBUTE_ANCHORS.hunter
  const clampedLevel = Math.min(Math.max(level, anchors[0][0]), anchors[anchors.length - 1][0])

  for (let i = 0; i < anchors.length; i += 1) {
    const [anchorLevel, anchorAttrs] = anchors[i]

    if (clampedLevel === anchorLevel) {
      return { ...anchorAttrs }
    }

    if (clampedLevel < anchorLevel) {
      const [prevLevel, prevAttrs] = anchors[i - 1]
      const t = (clampedLevel - prevLevel) / (anchorLevel - prevLevel)
      return {
        strength: Math.round(prevAttrs.strength + (anchorAttrs.strength - prevAttrs.strength) * t),
        agility: Math.round(prevAttrs.agility + (anchorAttrs.agility - prevAttrs.agility) * t),
        vitality: Math.round(prevAttrs.vitality + (anchorAttrs.vitality - prevAttrs.vitality) * t),
        spirit: Math.round(prevAttrs.spirit + (anchorAttrs.spirit - prevAttrs.spirit) * t),
      }
    }
  }

  return { ...anchors[anchors.length - 1][1] }
}

// Mirrors src/game/stats/derivedStats.ts
const BASE_HP = 50
const PHYSICAL_ATTACK_PER_STRENGTH = 2
const MAGIC_ATTACK_PER_SPIRIT = 2
const BASE_ATTACK_SPEED = 1.0

function computeDerivedStats(
  attributes: Attributes,
  equipmentBonus: { physicalAttack?: number; magicAttack?: number; dexterity?: number },
) {
  const hp = BASE_HP + attributes.vitality * 24 + attributes.strength * 3 + attributes.agility * 3 + attributes.spirit * 3
  const physicalAttack = attributes.strength * PHYSICAL_ATTACK_PER_STRENGTH + (equipmentBonus.physicalAttack ?? 0)
  const magicAttack = attributes.spirit * MAGIC_ATTACK_PER_SPIRIT + (equipmentBonus.magicAttack ?? 0)
  // Mirrors derivedStats.ts — 1 dexterity per Agility point plus Bows'/Rings'
  // own dexterity stat (a separate gear pool from dodge, which is Boots-only
  // and not tracked here at all — see the equipmentBonus comment above for
  // why incoming mitigation isn't simulated server-side). Used here for
  // outgoing hit chance only (see the deterministic hitChance calc below).
  const dexterity = attributes.agility * 1 + (equipmentBonus.dexterity ?? 0)
  return { hp, physicalAttack, magicAttack, attackSpeed: BASE_ATTACK_SPEED, dexterity }
}

// Mirrors src/game/items/equipmentBonus.ts (recalibrated 2026-07-31 — 1 + weight/4
// using the confirmed battle-power weighting, was a stale 1/1.1/1.2/1.35/1.5 that
// never got updated here when the client-side constant changed).
const QUALITY_STAT_MULTIPLIERS: Record<string, number> = {
  normal: 1,
  tempered: 1.25,
  infused: 1.5,
  radiant: 1.75,
  ascended: 2,
}

function scaledStat(baseStats: Record<string, number>, key: string, qualityTier: string): number | undefined {
  const base = baseStats[key]
  if (typeof base !== 'number') return undefined
  return Math.round(base * (QUALITY_STAT_MULTIPLIERS[qualityTier] ?? 1))
}

// Mirrors src/game/items/equipmentBonus.ts's computeCompositionBonusStats —
// 5%/tier flat on the item's raw base stat, deliberately kept out of
// QUALITY_STAT_MULTIPLIERS/the account-wide attack bonus below (summed as
// its own flat addend, not folded into scaledStat/attackMidpoint's other
// multipliers). Only physical_attack/magic_attack matter here — defense/
// dodge composition bonuses aren't simulated server-side at all, same as the
// rest of incoming mitigation (see the comment above equipmentBonus).
const COMPOSITION_BONUS_PCT_PER_TIER = 0.05

const COMPOSITION_BONUS_STAT_KEYS: Record<string, string[]> = {
  weapon: ['physical_attack', 'magic_attack'],
  ring: ['physical_attack'],
}

function compositionBonusStat(
  baseStats: Record<string, number>,
  key: string,
  slotType: string | undefined,
  compositionLevel: number,
): number {
  if (!slotType || compositionLevel <= 0) return 0
  if (!COMPOSITION_BONUS_STAT_KEYS[slotType]?.includes(key)) return 0
  const base = baseStats[key]
  if (typeof base !== 'number') return 0
  return Math.round(base * COMPOSITION_BONUS_PCT_PER_TIER * compositionLevel)
}

// Mirrors src/game/combat/combatResolver.ts
const RARE_CHANCE = 0.05
const RARE_HP_MULTIPLIER = 2
const RARE_REWARD_MULTIPLIER = 5
const MIN_DAMAGE_PERCENT_OF_ATTACK = 0.1

// Expected-value combat reward rewrite (2026-08-11, see CLAUDE.md's Combat
// section) — the reward loop below no longer rolls "is this specific spawn
// rare" per kill for gold/EXP/kill-count purposes (that's still rolled, but
// only for the cosmetic rare-monster glow/toast/log flavor and the
// response's informational rareKills count). Reward math instead folds
// rare's 5% chance / 2x HP / 5x reward into a blended expected-value
// multiplier, since tying reward math to an individual random roll is
// exactly the kind of per-window RNG divergence this rewrite removes — a
// single rare kill landing on one side of a resolve-window boundary but not
// the other would reintroduce it, worse (a 5x swing instead of a 1x one).
// Each factor is `(1 - RARE_CHANCE) + RARE_CHANCE * <rare's own multiplier
// for that quantity>` — the expected value of the rare/not-rare coin flip.
const RARE_BLENDED_HP_FACTOR = (1 - RARE_CHANCE) + RARE_CHANCE * RARE_HP_MULTIPLIER // 1.05
const RARE_BLENDED_REWARD_FACTOR = (1 - RARE_CHANCE) + RARE_CHANCE * RARE_REWARD_MULTIPLIER // 1.2
// Damage-dealt EXP's own blend is different from the other two: a rare
// spawn's damage-EXP per point of raw damage dealt scales by
// (RARE_REWARD_MULTIPLIER / RARE_HP_MULTIPLIER) relative to normal, not by
// RARE_REWARD_MULTIPLIER alone — a rare monster's real HP pool doubles too,
// which already halves the per-point-of-damage fraction before the 5x
// reward multiplier is applied on top (see monster.max_hp's use below).
const RARE_BLENDED_DAMAGE_EXP_FACTOR = (1 - RARE_CHANCE) + RARE_CHANCE * (RARE_REWARD_MULTIPLIER / RARE_HP_MULTIPLIER) // 1.075
// Comet/Fallen Star kill-drop odds — confirmed, flat (reverted 2026-08-03: a
// same-day earlier attempt scaled *this* base rate by monster level, but the
// user clarified that was the wrong lever — the base rate was never the
// problem and stays untouched. See rollBonusCurrencyDrops's own
// accountDropMultiplier for the real bonus-drop-chance source now.).
const COMET_DROP_CHANCE = 1 / 500
const FALLEN_STAR_DROP_CHANCE = 1 / 20000
// Gear drop rate + per-drop quality odds (confirmed with the user,
// 2026-08-01) — supersedes the earlier flat 10%-per-kill/always-Normal-
// quality placeholder. A drop itself is now genuinely rare on its own; the
// quality of that drop is then a separate, much rarer roll layered on top
// (checked rarest-first, first hit wins, otherwise Normal) rather than every
// drop defaulting to Normal — Quality Upgrade in the Forge is no longer the
// only way to ever see a non-Normal item. Mirrored client-side in
// useInventoryStore.ts's DROP_CHANCE (that copy is predictive-only — combat
// log flavor text — so it doesn't need the quality roll, just the rate).
//
// Quality odds recalibrated 2026-08-10 (confirmed with the user, reported
// the old table as "very high" i.e. far too rare) — grounded in expCurve.ts's
// own ~1,200 kills/hour constant (3 hits/kill @ 1 attack/sec, deliberately
// flat across every level), so a 2-hour AFK-cap session is ~2,400 kills.
// Target was 1-5 Tempered / a couple Infused / potentially a Radiant / an
// Ascended about once/day (~4 two-hour sessions), which — with DROP_CHANCE
// left untouched per the user's explicit call to use quality odds as the
// only lever — works out to conditional (given-a-drop) chances of 3/32
// Tempered, 1/16 Infused, 3/200 Radiant, 3/400 Ascended (~17.9% of drops
// Tempered-or-better). Then halved across the board as a deliberate safety
// margin at the user's request before shipping: ~1.5 Tempered / ~1 Infused /
// ~0.24 Radiant / ~0.12 Ascended expected per 2-hour session.
const DROP_CHANCE = 1 / 150
const QUALITY_DROP_CHANCES: [tier: string, chance: number][] = [
  ['ascended', 3 / 400],
  ['radiant', 3 / 200],
  ['infused', 1 / 16],
  ['tempered', 3 / 32],
]

// qualityBonusMultiplier (2026-08-07, confirmed with the user, supersedes
// the old flat account_drop_bonus_pct's effect on DROP_CHANCE itself below)
// — the account track's per-zone drop-bonus reward no longer scales how
// often a normal item drops at all; it scales THIS roll instead, given a
// drop already happened. See accountDropMultiplier's own new zone-scoped
// computation further down.
function rollDroppedQualityTier(qualityBonusMultiplier = 1): string {
  for (const [tier, chance] of QUALITY_DROP_CHANCES) {
    if (Math.random() < chance * qualityBonusMultiplier) return tier
  }
  return 'normal'
}

// Achievements & Pets (confirmed shape, see CLAUDE.md — the tracking
// mechanism is real, the reward VALUES below are a deliberate uniform
// placeholder). Mirrors src/game/achievements/achievementData.ts — keep in
// sync.
const ACHIEVEMENT_TIERS = [100, 250, 500, 1000, 5000, 10000]

// Reworked (2026-08-06, confirmed with the user) — supersedes the old
// dual-track system (an always-on Kill Count bonus-drop multiplier + a paid
// Prestige gold multiplier, both applied automatically as soon as a tier
// was reached/bought). Both are gone: Kill Count and Prestige are now a
// single character-scoped Kill Count ladder with real one-time CLAIMS
// (claim_kill_count_reward, a separate Postgres RPC — not applied here,
// since claiming isn't a combat action) instead of a passive multiplier
// this function used to compute and apply automatically. The account-wide
// ladder (still tracked below, unchanged) now has its own reward category
// instead — small permanent combat buffs, read directly from `players`
// below (account_zone_attack_bonus_pct/account_zone_drop_bonus_pct, both
// per-zone) rather than derived from anything achievement-tier-shaped here.

// Confirmed, not a placeholder — 1/25000 chance per kill (lowered from the
// original 1/5000, 2026-08-03), independent of every other roll this
// function makes. Mirrors achievementData.ts — keep in sync.
const PET_DROP_CHANCE = 1 / 25000

// Zone-level Achievements layer (2026-08-03, confirmed with the user,
// additive to the per-monster system above, not a replacement — see the
// migration's own header for the full write-up). Every zone has exactly 5
// monsters (confirmed by CLAUDE.md's Zones section), so 5 monsters x 6 tiers
// = 30 possible tier-milestones per zone, uniformly — this even 6-step
// ladder (5/10/15/20/25/30) mirrors every other tier system in this game.
// Comet Scroll reward per zone tier, PLACEHOLDER, escalating (was a Fallen
// Star reward — switched 2026-08-07, confirmed with the user: every Fallen
// Star reward on the Achievements system moves to a Comet Scroll instead,
// same quantities). Granted unconditionally (no Inventory-cap gating, no
// Loot Holding routing) — a rare, one-time milestone crossing, same
// "shouldn't silently fail" reasoning as the tier-6 Infused gear reward.
const ZONE_TIER_COMPLETIONS = [5, 10, 15, 20, 25, 30]
const ZONE_TIER_COMET_SCROLL_REWARD = [1, 2, 3, 4, 5, 8]

// How many of this zone's 30 possible tier-milestones a set of per-monster
// kill counts has reached in total, and which zone tier (0-6) that maps to.
function zoneTierCompletions(zoneMonsterKills: number[]): { completions: number; zoneTier: number } {
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

type LevelDiffColor = 'white' | 'green' | 'red' | 'black'

function getLevelDiffColor(characterLevel: number, monsterLevel: number): LevelDiffColor {
  const diff = characterLevel - monsterLevel
  if (diff <= -5) return 'black'
  if (diff <= -3) return 'red'
  if (diff >= 3) return 'green'
  return 'white'
}

const EXP_MULTIPLIER_BY_COLOR: Record<LevelDiffColor, number> = { black: 2, red: 1.5, white: 1, green: 0.5 }

// Level-gap Defense debuff (2026-08-05) — mirrors combatResolver.ts's
// MONSTER_DEFENSE_MULTIPLIER_BY_COLOR. Outgoing only (player hits monster):
// a monster the character comfortably outlevels (Green/White) loses some of
// its own Defense, so it "hits back less" in the sense that it also dies
// faster — makes farming below your level feel meaningfully easier, not just
// EXP-discounted. Red/Black (monster outlevels character) are unaffected
// here — see combatResolver.ts for why the incoming side (player Defense vs.
// Red/Black monsters) is a separate, asymmetric table, and why incoming
// player-HP damage is client-only and never mirrored here.
const MONSTER_DEFENSE_MULTIPLIER_BY_COLOR: Record<LevelDiffColor, number> = {
  green: 0.5,
  white: 0.75,
  red: 1,
  black: 1,
}

interface EnemyType {
  level: number
  max_hp: number
  gold_reward: number
  // exp_reward column still exists on enemy_types but is deliberately not
  // read here anymore — see expRewardForLevel above.
  attack_damage: number
}

function rollIsRare(): boolean {
  return Math.random() < RARE_CHANCE
}

function monsterDefense(type: EnemyType, characterLevel: number): number {
  const base = Math.round(type.level * 1.5)
  return Math.round(base * MONSTER_DEFENSE_MULTIPLIER_BY_COLOR[getLevelDiffColor(characterLevel, type.level)])
}

// Mirrors combatResolver.ts's monsterDodge (2026-08-02) — must stay in
// sync. Feeds the deterministic hitChance calc in the main reward math
// below, which changes how much of a resolve window's expected damage
// actually lands — still affects real kills/rewards, not just player HP
// (which isn't simulated server-side).
//
// Lowered 2026-08-11 from 0.005 — see combatResolver.ts's comment (Hunter's
// Agility alone saturated the 50% cap by ~level 45 at the old rate).
const DODGE_CHANCE_PER_POINT = 0.0015
const MAX_DODGE_CHANCE = 0.5

function monsterDodge(type: EnemyType): number {
  return Math.round(type.level * 0.8)
}

function resolvePhysicalDamage(attack: number, defense: number): number {
  const mitigated = attack - defense
  const floor = Math.round(attack * MIN_DAMAGE_PERCENT_OF_ATTACK)
  return Math.max(mitigated, floor, 1)
}

// dropMultiplier — the account-wide claimed drop-bonus buff (see
// accountDropMultiplier above), applied to both flat base chances alike.
function rollBonusCurrencyDrops(dropMultiplier: number) {
  return {
    comets: Math.random() < COMET_DROP_CHANCE * dropMultiplier ? 1 : 0,
    fallenStars: Math.random() < FALLEN_STAR_DROP_CHANCE * dropMultiplier ? 1 : 0,
  }
}

// Mirrors src/game/stats/useProgressionStore.ts's real EXP curve (confirmed
// 2026-07-30 reference data).
const MAX_CHARACTER_LEVEL = 130
const EXP_CURVE_ANCHORS: [number, number][] = [
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

function requiredExpForLevel(level: number): number {
  const clampedLevel = Math.min(Math.max(level, 1), MAX_CHARACTER_LEVEL)
  for (let i = 0; i < EXP_CURVE_ANCHORS.length; i += 1) {
    const [anchorLevel, anchorValue] = EXP_CURVE_ANCHORS[i]
    if (clampedLevel === anchorLevel) return anchorValue
    if (clampedLevel < anchorLevel) {
      const [prevLevel, prevValue] = EXP_CURVE_ANCHORS[i - 1]
      const t = (clampedLevel - prevLevel) / (anchorLevel - prevLevel)
      return Math.round(prevValue * (anchorValue / prevValue) ** t)
    }
  }
  return EXP_CURVE_ANCHORS[EXP_CURVE_ANCHORS.length - 1][1]
}

// Monster EXP reward — recalibrated 2026-08-05 (confirmed with the user,
// reported as "the entire week I've only gotten to level 23"). Formula-
// derived from the monster's own level now, instead of the old hand-placed
// enemy_types.exp_reward column (still exists in the DB, deliberately no
// longer read here) — mirrors src/game/stats/expCurve.ts's own
// expRewardForLevel; see that file's comment for the full "why" and for why
// this steps up at each promotion tier rather than using one flat rate
// (confirmed with the user: "it should feel harder as you level up"), and for
// why this table was retuned a second time the same day (steeper tier-to-tier
// jumps — "later levels should take longer"). Both tables must stay in sync
// with expCurve.ts.
const PROMOTION_TIER_ANCHORS = [1, 15, 40, 70, 100, 110, 120]
const KILLS_PER_LEVEL_BY_TIER = [200, 350, 650, 1300, 2600, 5200, 10000]

// Idle/offline EXP rate — confirmed with the user, 2026-08-05: live play
// keeps the full expRewardForLevel/damage-dealt-EXP rate above; the once-at-
// login offline catch-up (mode === 'offline') earns EXP at half that rate,
// so actually playing is meaningfully better than leaving the game running,
// without making AFK catch-up pointless. Deliberately EXP-only, same as the
// existing White/Green/Red/Black level-diff multiplier above — gold is
// unaffected in either mode. Applied once to the whole window's expGained
// total right before the level-up loop, not per-hit/per-kill, since it's
// mathematically identical and cheaper.
const IDLE_EXP_MULTIPLIER = 0.5

function killsPerLevelForLevel(level: number): number {
  let tierIndex = 0
  for (let i = 0; i < PROMOTION_TIER_ANCHORS.length; i += 1) {
    if (level >= PROMOTION_TIER_ANCHORS[i]) {
      tierIndex = i
    }
  }
  return KILLS_PER_LEVEL_BY_TIER[tierIndex]
}

function expRewardForLevel(level: number): number {
  return Math.max(1, Math.round(requiredExpForLevel(level) / killsPerLevelForLevel(level)))
}

// Damage-dealt EXP (confirmed with the user, 2026-08-05, matching a real
// Conquer Online mechanic) — mirrors expCurve.ts's DAMAGE_EXP_SHARE. Every
// point of expected damage dealt earns a slice of the target's own EXP
// reward proportional to how much of its max HP it represents, on top of
// (not instead of) the full kill EXP grant — a full kill nets
// (1 + DAMAGE_EXP_SHARE) of the base reward. Computed as a closed-form total
// over the whole window now (see the main reward math below) rather than
// per individual hit. DAMAGE_EXP_SHARE must stay in sync with expCurve.ts.
const DAMAGE_EXP_SHARE = 0.5

// AFK-cap Kill Count tier reward (confirmed with the user, 2026-08-05,
// rebased 2026-08-06 onto the reworked single Kill Count track now that
// Prestige is gone — see the achievements-rework migration) — the bounded
// elapsed-time window a single resolve call will simulate (shared by live
// ~15s calls and the once-at-login offline catch-up) scales with the
// highest Achievements tier this account has *claimed* on any monster,
// rather than a flat 2 hours for everyone regardless of progress.
// PLACEHOLDER tier->hours table, same disclosed-not-final status as the
// rest of this reward economy — see the query/computation right before the
// main attack loop below.
//
// Rebased onto the ACCOUNT track (2026-08-07, reported by the user: a
// same-day-reachable 9-hour idle window felt broken). Originally scaled off
// the per-character Kill Count claim (character_monster_kills.
// claimed_tier_index) — that made sense back when the analogous claim was
// paid, escalating-cost Prestige, but the achievements rework replaced it
// with a *free* claim gated only on kills, so tier 4 (1000 kills on one
// monster) became trivially reachable in a single normal session, handing
// out a 9h cap far earlier than intended. The account track's own
// thresholds are 5x the character ones (500/1250/2500/5000/25000/50000,
// summed across all 5 character slots) and still require an explicit claim
// — a meaningfully slower, harder-to-snowball basis for a reward this
// large, closer to the original "significant investment" intent.
const BASE_AFK_CAP_MS = 2 * 60 * 60 * 1000
const AFK_CAP_MS_BY_ACCOUNT_TIER: Record<number, number> = {
  0: 2 * 60 * 60 * 1000,
  1: 3 * 60 * 60 * 1000,
  2: 4 * 60 * 60 * 1000,
  3: 6 * 60 * 60 * 1000,
  4: 9 * 60 * 60 * 1000,
  5: 14 * 60 * 60 * 1000,
  6: 20 * 60 * 60 * 1000,
}

// Mirrors useInventoryStore.ts's INVENTORY_SLOT_CAP / occupiedSlotCount.
const INVENTORY_SLOT_CAP = 40
const LOOT_HOLDING_CAP = 100

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  // Wrapped so any unexpected error (a bad query, a null somewhere it
  // shouldn't be) comes back as a diagnosable JSON body instead of an opaque
  // failure with no detail — useful while getting this deployed and tested
  // for the first time.
  try {
    return await handleResolveCombat(req)
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    // Supabase's log table doesn't capture response bodies, only console
    // output — logging here is what makes the Dashboard's Logs tab show the
    // real cause instead of just a bare 500.
    console.error('resolve-combat unhandled exception:', detail)
    return json({ ok: false, error: 'unhandled_exception', detail }, 500)
  }
})

async function handleResolveCombat(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ ok: false, error: 'not_authenticated' }, 401)
  }

  let characterId: string | undefined
  // 'live' (periodic/triggered calls while actively fighting, CombatEngine.tsx)
  // vs. 'offline' (the once-at-login away-time catch-up, offlineProgress.ts) —
  // confirmed with the user, 2026-07-31: these now diverge on what happens
  // when a drop can't fit in Inventory. Defaults to 'offline' (the original,
  // Loot-Holding-overflow behavior) if a caller ever omits it, rather than
  // failing the request outright.
  let mode: 'live' | 'offline' = 'offline'
  try {
    const body = await req.json()
    characterId = body.characterId
    if (body.mode === 'live' || body.mode === 'offline') {
      mode = body.mode
    }
  } catch {
    // fall through to the missing-characterId check below
  }

  if (!characterId) {
    return json({ ok: false, error: 'missing_character_id' }, 400)
  }

  // Verify the caller's own identity from their JWT (never trust characterId
  // ownership without this) using an anon-key client scoped to their token.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: authError,
  } = await callerClient.auth.getUser()

  if (authError || !user) {
    return json({ ok: false, error: 'not_authenticated' }, 401)
  }

  // Privileged reads/writes happen only through this service-role client, and
  // only after the ownership check just below — mirrors the SECURITY DEFINER
  // RPC pattern used everywhere else in this project (verify ownership, then
  // act with elevated privilege), just in a different runtime.
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: character, error: characterError } = await db
    .from('characters')
    .select(
      'id, account_id, class, level, gold, exp, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count, equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id, equipped_hat_id, equipped_coat_id, equipped_quiver_id, selected_monster_id, combat_last_resolved_at',
    )
    .eq('id', characterId)
    .maybeSingle()

  // Distinct from the ownership check below — a query error (e.g. a column
  // that doesn't exist yet because the migration hasn't run) should surface
  // as its own diagnosable error, not get silently folded into "not_owner".
  if (characterError) {
    console.error('resolve-combat characters query failed:', characterError.message)
    return json({ ok: false, error: 'query_failed', detail: characterError.message }, 500)
  }

  if (!character || character.account_id !== user.id) {
    return json({ ok: false, error: 'not_owner' }, 403)
  }

  const now = Date.now()
  const lastResolvedMs = new Date(character.combat_last_resolved_at).getTime()

  // Nothing selected to fight — just advance the clock so a later resolve
  // doesn't get an inflated window once a monster IS selected. The AFK-cap
  // Prestige tier bonus (see below) doesn't matter here since nothing is
  // being simulated either way — a flat base cap is enough for this
  // cosmetic elapsedMs value.
  if (!character.selected_monster_id) {
    const provisionalElapsedMs = Math.min(Math.max(now - lastResolvedMs, 0), BASE_AFK_CAP_MS)
    await db.from('characters').update({ combat_last_resolved_at: new Date(now).toISOString() }).eq('id', characterId)
    return json({
      ok: true,
      elapsedMs: provisionalElapsedMs,
      gained: { kills: 0, rareKills: 0, gold: 0, exp: 0, comets: 0, fallenStars: 0 },
      character: {
        gold: character.gold,
        exp: character.exp,
        level: character.level,
        comets: character.comet_count,
        fallenStars: character.fallen_star_count,
      },
      itemsGranted: [],
      itemsHeld: [],
      currencyHeld: [],
      inventoryFull: false,
      monsterId: null,
      characterKillCount: 0,
      accountKillCount: 0,
      petObtained: null,
    })
  }

  const { data: monster } = await db.from('enemy_types').select('*').eq('id', character.selected_monster_id).maybeSingle()

  if (!monster) {
    await db.from('characters').update({ combat_last_resolved_at: new Date(now).toISOString() }).eq('id', characterId)
    return json({ ok: false, error: 'unknown_monster' })
  }

  // AFK cap — Achievements tier reward (see AFK_CAP_MS_BY_ACCOUNT_TIER
  // above): the highest tier this ACCOUNT has *claimed* on any monster's
  // account-wide ladder decides how much away-time this call will credit,
  // capped at BASE_AFK_CAP_MS (2 hours) for an account with no claims at
  // all. Queries account_monster_kills (not character_monster_kills) — see
  // this constant's own header comment for why.
  const { data: bestClaimedTierRow } = await db
    .from('account_monster_kills')
    .select('claimed_tier_index')
    .eq('account_id', character.account_id)
    .order('claimed_tier_index', { ascending: false })
    .limit(1)
    .maybeSingle()
  const bestClaimedTier = Math.min(Math.max(bestClaimedTierRow?.claimed_tier_index ?? 0, 0), 6)
  const afkCapMs = AFK_CAP_MS_BY_ACCOUNT_TIER[bestClaimedTier] ?? BASE_AFK_CAP_MS
  const elapsedMs = Math.min(Math.max(now - lastResolvedMs, 0), afkCapMs)

  // Character combat stats — derived server-side, never trusted from the
  // request. Attributes are a pure function of (class, level) via
  // auto-allotment (see classes.ts); gear bonus sums physical_attack/
  // magic_attack/dexterity across every equipped slot (Ring/Necklace/Boots/
  // Hat/Coat are now functional too, not just Main Hand — see
  // useEquipmentStore.ts/computeEquipmentBonus's client-side mirror).
  // physicalDefense/dodge (Boots' evasion stat) still aren't simulated
  // server-side (player HP/knockout only ever lived in
  // useCombatStore.runTick, an accepted gap) — but dexterity (Bows'/Rings'
  // own accuracy stat, a separate stat from dodge as of 2026-08-02) matters
  // here too, since it drives the player's own outgoing hit chance against
  // monster Dodge (see the deterministic hitChance calc below), which
  // affects real kill counts/rewards, unlike incoming mitigation.
  const attributes = getAttributesForLevel(character.class ?? 'hunter', character.level)
  const equipmentBonus: { physicalAttack: number; magicAttack: number; dexterity: number } = {
    physicalAttack: 0,
    magicAttack: 0,
    dexterity: 0,
  }
  // Kept out of equipmentBonus.physicalAttack/magicAttack — those feed
  // attackMidpoint, which the account-wide attack bonus % multiplies below;
  // composition's attack bonus must not compound with that multiplier (see
  // compositionBonusStat's comment), so it's added back in unscaled after.
  let compositionAttackBonus = 0

  const equippedItemIds = [
    character.equipped_weapon_id,
    character.equipped_ring_id,
    character.equipped_necklace_id,
    character.equipped_boots_id,
    character.equipped_hat_id,
    character.equipped_coat_id,
  ].filter((id): id is string => Boolean(id))

  if (equippedItemIds.length > 0) {
    const { data: equippedItems } = await db
      .from('item_instances')
      .select('id, quality_tier, template_id, composition_level')
      .in('id', equippedItemIds)

    if (equippedItems && equippedItems.length > 0) {
      const { data: equippedTemplates } = await db
        .from('item_templates')
        .select('id, base_stats, slot_type')
        .in(
          'id',
          equippedItems.map((item) => item.template_id),
        )

      for (const item of equippedItems) {
        const template = equippedTemplates?.find((t) => t.id === item.template_id)
        if (!template) continue
        equipmentBonus.physicalAttack += scaledStat(template.base_stats, 'physical_attack', item.quality_tier) ?? 0
        equipmentBonus.magicAttack += scaledStat(template.base_stats, 'magic_attack', item.quality_tier) ?? 0
        equipmentBonus.dexterity += scaledStat(template.base_stats, 'dexterity', item.quality_tier) ?? 0
        compositionAttackBonus += compositionBonusStat(
          template.base_stats,
          'physical_attack',
          template.slot_type,
          item.composition_level,
        )
        compositionAttackBonus += compositionBonusStat(
          template.base_stats,
          'magic_attack',
          template.slot_type,
          item.composition_level,
        )
      }
    }
  }

  const derived = computeDerivedStats(attributes, equipmentBonus)
  const attackIntervalMs = 1000 / derived.attackSpeed
  // Account-wide attack buff (see accountAttackBonusPct below, fetched
  // further down) is applied once this value is reassigned right after that
  // fetch completes — declared here (before totalAttacks/the Quiver gate,
  // which don't depend on it) so the rest of this function reads it in one
  // place.
  let attackMidpoint = derived.physicalAttack + derived.magicAttack

  // Hunter must have the Quiver equipped to attack at all (confirmed with the
  // user, 2026-07-31 — supersedes the earlier ammo-stack/consumption model
  // entirely). No count, no per-attack consumption — equipped or not is the
  // whole gate, same as the client-side mirror in useCombatStore.runTick.
  const isHunter = character.class === 'hunter'
  let totalAttacks = Math.floor(elapsedMs / attackIntervalMs)
  if (isHunter && !character.equipped_quiver_id) {
    totalAttacks = 0
  }

  let kills = 0
  let rareKills = 0
  let goldGained = 0
  let expGained = 0
  let cometsGained = 0
  let fallenStarsGained = 0
  // Live mode only (confirmed with the user, 2026-07-31): set the moment a
  // kill rolls a drop that can't fit, at which point the whole simulated
  // window stops right there rather than continuing to fight and stashing
  // the overflow in Loot Holding — "a full inventory should stop combat."
  // Loot Holding is now exclusively for the offline/idle catch-up window
  // (surfaced in OfflineProgressModal, not a persistent Warehouse card).
  let inventoryFull = false
  const droppedTemplates: { id: string; required_level: number; qualityTier: string }[] = []

  // Excludes equipped and Bank-Storage gear from the room-fit baseline below
  // (fixed 2026-08-05, reported by the user via unbundle_currency_scroll's
  // own copy of this same bug — see that migration's comment for the full
  // writeup). Matches useInventoryStore.occupiedSlotCount's client-side
  // formula exactly: neither an equipped item (shown only on the paper doll)
  // nor a Bank-Storage item (shown only in Bank Storage) occupies a real
  // Inventory slot, but the query below used to count both anyway.
  const equippedIdsForRoomCheck = [
    character.equipped_weapon_id,
    character.equipped_ring_id,
    character.equipped_necklace_id,
    character.equipped_boots_id,
    character.equipped_hat_id,
    character.equipped_coat_id,
    character.equipped_quiver_id,
  ].filter((id): id is string => Boolean(id))

  let gearCountQuery = db.from('item_instances').select('id', { count: 'exact', head: true }).eq('owner_id', characterId).neq('location', 'bank')
  if (equippedIdsForRoomCheck.length > 0) {
    gearCountQuery = gearCountQuery.not('id', 'in', `(${equippedIdsForRoomCheck.join(',')})`)
  }

  // Inventory-full handling baseline — fetched BEFORE the loop now (used to
  // be after), so live mode can check fit live, kill by kill, as the window
  // is simulated. Functionally identical for offline mode either way, since
  // nothing else in this function touches these tables mid-request.
  const [
    { count: gearCount },
    { data: composition },
    { count: holdingCount },
    { count: potionCount },
    { data: characterKillsRow },
    { data: accountKillsRow },
    { data: petRow },
    { data: playerRow },
  ] = await Promise.all([
    gearCountQuery,
    db.from('characters').select('composition_stones').eq('id', characterId).maybeSingle(),
    db.from('loot_holding').select('id', { count: 'exact', head: true }).eq('character_id', characterId),
    db.from('potion_stacks').select('id', { count: 'exact', head: true }).eq('character_id', characterId).gt('count', 0),
    // Achievements & Pets — this monster's existing kill-count rows (both
    // ladders) and whether its pet is already obtained account-wide.
    // Fetched here, alongside the other per-request baselines, rather than a
    // separate round-trip. claimed_tier_index is read only for the upsert
    // below (to preserve it — claiming itself happens in a separate RPC,
    // never here), not for any reward math anymore (see the achievements
    // rework note above).
    db
      .from('character_monster_kills')
      .select('kills, claimed_tier_index')
      .eq('character_id', characterId)
      .eq('monster_id', character.selected_monster_id)
      .maybeSingle(),
    db
      .from('account_monster_kills')
      .select('kills')
      .eq('account_id', character.account_id)
      .eq('monster_id', character.selected_monster_id)
      .maybeSingle(),
    db.from('account_pets').select('id').eq('account_id', character.account_id).eq('monster_id', character.selected_monster_id).maybeSingle(),
    // Achievements rework (2026-08-06) — the account-wide claimed-buff
    // totals, read fresh every resolve and applied directly below (attack
    // to the damage roll, drop to both the gear and Comet/Fallen Star
    // rolls). Permanent once claimed, so no separate "is this active" gate
    // is needed the way the old per-monster tier lookups needed — just read
    // and apply.
    db.from('players').select('account_zone_attack_bonus_pct, account_zone_drop_bonus_pct').eq('id', character.account_id).maybeSingle(),
  ])

  // Number(...) defensively — PostgREST can serialize a `numeric` column as
  // a JSON string in some client configurations to avoid float precision
  // loss; a plain number passes through Number() unchanged either way.
  const characterKillsBefore = Number(characterKillsRow?.kills ?? 0)
  const accountKillsBefore = Number(accountKillsRow?.kills ?? 0)
  const petAlreadyUnlocked = Boolean(petRow)
  // Both per-zone now (2026-08-07, confirmed with the user — attack bonus
  // was previously a flat account-wide number applied to every fight
  // regardless of zone, "I hope it's not a global attack bonus"), scoped to
  // whichever zone the currently-fought monster belongs to. Grinding one
  // zone's own account-tier claims only pays off specifically while
  // farming that zone. Quality's own bonus total is deliberately higher for
  // later zones (see claim_account_achievement_reward's own
  // zone_quality_bonus_per_tier_pct); Attack is flat 1%/tier everywhere.
  const zoneKey = monster.zone_id ?? ''
  const accountAttackBonusPct = (playerRow?.account_zone_attack_bonus_pct as Record<string, number> | null)?.[zoneKey] ?? 0
  const zoneDropBonusPct = (playerRow?.account_zone_drop_bonus_pct as Record<string, number> | null)?.[zoneKey] ?? 0
  const accountDropMultiplier = 1 + zoneDropBonusPct / 100
  attackMidpoint *= 1 + accountAttackBonusPct / 100
  // Added in unscaled, after the account-wide multiplier — see
  // compositionAttackBonus's declaration above.
  attackMidpoint += compositionAttackBonus
  // Same White/Green/Red/Black level-diff EXP multiplier applied to both
  // kill EXP and damage-dealt EXP below (see EXP_MULTIPLIER_BY_COLOR/
  // getLevelDiffColor), precomputed once here.
  const expMultiplier = EXP_MULTIPLIER_BY_COLOR[getLevelDiffColor(character.level, monster.level)]
  let killsThisWindow = 0
  let petObtained = false

  const stoneSlotCount = Object.values((composition?.composition_stones as Record<string, number>) ?? {}).reduce(
    (sum, v) => sum + (typeof v === 'number' ? v : 0),
    0,
  )
  // Bug fix (2026-07-31): this baseline previously omitted potions and the
  // character's own already-owned Comet/Fallen Star/Scroll counts entirely —
  // it only ever counted gear + stones, silently under-counting real
  // Inventory fullness (see CLAUDE.md's Warehouse economy redesign note,
  // stage 2 — caught while adding Scroll accounting here). Mirrors
  // useInventoryStore.occupiedSlotCount's client-side formula in full now.
  let occupied =
    (gearCount ?? 0) +
    stoneSlotCount +
    (potionCount ?? 0) +
    character.comet_count +
    character.fallen_star_count +
    character.comet_scroll_count +
    character.fallen_star_scroll_count
  let heldCount = holdingCount ?? 0
  // Live mode only — a running projection of `occupied` as this window's
  // kills are simulated, so a mid-window fit-check can be made without
  // mutating the real `occupied` the post-loop granting pass still uses.
  // The two never disagree (both start from the same baseline and increment
  // by the same items in the same order), so the post-loop pass never needs
  // its own live/offline branch — for live mode, anything in
  // droppedTemplates/cometsGained/fallenStarsGained was already confirmed
  // to fit at roll time, so occupied is guaranteed to still have room when
  // the post-loop pass reaches it.
  let projectedOccupied = occupied

  if (totalAttacks > 0) {
    // Deterministic expected-value reward math (2026-08-11 rewrite, see
    // CLAUDE.md's Combat section) — replaces the old per-attack RNG
    // simulation (roll hit/miss, roll damage-in-range, roll "is this kill
    // rare" per spawn) with closed-form math computed once for the whole
    // window. This is what makes the client's own prediction (see
    // combatResolver.ts's mirrored functions) match this server-confirmed
    // result almost exactly — two independent RNG simulations of the same
    // window can disagree by a kill or two, but two evaluations of the same
    // formula over the same elapsed time cannot.
    const hitChance =
      1 - Math.min(Math.max(0, monsterDodge(monster) - derived.dexterity) * DODGE_CHANCE_PER_POINT, MAX_DODGE_CHANCE)
    const expectedDamagePerHit = resolvePhysicalDamage(attackMidpoint, monsterDefense(monster, character.level))
    const totalExpectedDamage = totalAttacks * hitChance * expectedDamagePerHit
    const expectedKillsThisWindow = totalExpectedDamage / (monster.max_hp * RARE_BLENDED_HP_FACTOR)

    // How many WHOLE kills this window actually crosses, combining the
    // fractional running total already on the row (characterKillsBefore,
    // now a numeric column — see the migration that widened it) with this
    // window's own fractional contribution, the same "carry the remainder
    // forward" idea the EXP level-up loop already uses. Bounded/small (real
    // kills, not attacks), so looping this many times for drop/currency/pet
    // rolls only is cheap even though totalAttacks itself can be large for
    // a fast weak monster.
    const wholeKillsThisWindow = Math.floor(characterKillsBefore + expectedKillsThisWindow) - Math.floor(characterKillsBefore)

    // Fraction of this window's deterministic totals actually credited —
    // stays 1 unless live mode runs out of Inventory room partway through
    // the whole-kill loop below, at which point it's trimmed to match "a
    // kill's own reward still counts, the rest of the window doesn't" (the
    // same behavior the old per-attack loop had via its early break).
    let creditedFraction = 1

    if (wholeKillsThisWindow > 0) {
      // Fetched once (not per-roll) and reused for every drop this window
      // rolls — level-appropriate selection (confirmed with the user,
      // 2026-07-30): picks a random gear family available to the
      // character's class (excluding the standalone 'sword' family — the
      // legacy Wooden Sword freebie isn't meant to drop from monsters —
      // and 'quiver', a starter/shop-only item for the same reason), then
      // the template in that family whose required_level is closest to the
      // monster's own level. Mirrors pickLevelAppropriateTemplate in
      // useInventoryStore.ts — must stay in sync, same pattern as this
      // file's other client/server mirrors.
      const { data: dropPool } = await db
        .from('item_templates')
        .select('id, required_level, item_family, required_class')
        .not('item_family', 'in', '("sword","quiver","lucky-bow","money-bag","gem-bag")')

      const pickDropTemplate = (): { id: string; required_level: number } | null => {
        const candidates = (dropPool ?? []).filter((t) => t.required_class === null || t.required_class === character.class)
        if (candidates.length === 0) return null
        const families = [...new Set(candidates.map((t) => t.item_family))]
        const family = families[Math.floor(Math.random() * families.length)]
        const inFamily = candidates.filter((t) => t.item_family === family)
        return inFamily.reduce((closest, t) =>
          Math.abs(t.required_level - monster.level) < Math.abs(closest.required_level - monster.level) ? t : closest,
        )
      }

      let killsProcessed = 0

      for (let i = 0; i < wholeKillsThisWindow; i += 1) {
        // Rare status is still rolled per whole kill here — but purely for
        // the cosmetic rareKills count in the response (e.g. an
        // offline-summary "X rare kills" callout). It no longer feeds
        // gold/EXP math at all (see RARE_BLENDED_REWARD_FACTOR above).
        if (rollIsRare()) rareKills += 1

        killsProcessed += 1

        if (!petAlreadyUnlocked && !petObtained && Math.random() < PET_DROP_CHANCE) {
          petObtained = true
        }

        // Per-zone quality-only drop bonus (2026-08-07, confirmed with the
        // user — supersedes the old flat, drop-FREQUENCY-boosting
        // account_drop_bonus_pct). accountDropMultiplier is now derived
        // from whichever zone this monster belongs to (see below) and is
        // deliberately NOT applied to the base drop roll anymore — a
        // claimed zone's bonus no longer makes a normal item drop more
        // often, only improves its odds of rolling a higher quality tier
        // once a drop already happened. Comet/Fallen Star drop chance
        // (just below) still uses the same multiplier, now zone-scoped
        // instead of flat.
        if (Math.random() < DROP_CHANCE) {
          const dropped = pickDropTemplate()
          if (dropped) {
            // Quality is rolled once, at drop time, and carried with the
            // template through to whichever table (item_instances or
            // loot_holding) ends up actually receiving it below.
            const withQuality = { ...dropped, qualityTier: rollDroppedQualityTier(accountDropMultiplier) }
            if (mode === 'live') {
              if (projectedOccupied < INVENTORY_SLOT_CAP) {
                droppedTemplates.push(withQuality)
                projectedOccupied += 1
              } else {
                inventoryFull = true
              }
            } else {
              droppedTemplates.push(withQuality)
            }
          }
        }

        const bonusCurrency = rollBonusCurrencyDrops(accountDropMultiplier)
        if (mode === 'live') {
          if (bonusCurrency.comets > 0) {
            if (projectedOccupied < INVENTORY_SLOT_CAP) {
              cometsGained += bonusCurrency.comets
              projectedOccupied += 1
            } else {
              inventoryFull = true
            }
          }
          if (bonusCurrency.fallenStars > 0) {
            if (projectedOccupied < INVENTORY_SLOT_CAP) {
              fallenStarsGained += bonusCurrency.fallenStars
              projectedOccupied += 1
            } else {
              inventoryFull = true
            }
          }
        } else {
          cometsGained += bonusCurrency.comets
          fallenStarsGained += bonusCurrency.fallenStars
        }

        // Live mode stops the whole window right here — matches "you'd have
        // stopped fighting the moment you couldn't carry any more loot."
        // creditedFraction below trims gold/EXP/kills to match.
        if (mode === 'live' && inventoryFull) {
          break
        }
      }

      if (killsProcessed < wholeKillsThisWindow) {
        creditedFraction = killsProcessed / wholeKillsThisWindow
      }
    }

    const creditedKills = expectedKillsThisWindow * creditedFraction
    const creditedDamage = totalExpectedDamage * creditedFraction

    kills = Math.round(creditedKills)
    // Math.round is required here (bug found 2026-08-11, reported by the
    // user) — unlike expGained below, this was left as a raw fractional
    // value, which then flowed into resolve_combat_apply_rewards' p_gold_delta
    // (a Postgres `integer` param). That silently failed the RPC call
    // (caught by the `if (rewardError || !rewardRow)` fallback below), which
    // fell back to a JS-computed fractional gold total that was never
    // actually written to the DB — the client then tried to autosave that
    // fractional value into characters.gold (also `integer`) via a direct
    // PATCH, which failed with "invalid input syntax for type integer".
    goldGained += Math.round(creditedKills * monster.gold_reward * RARE_BLENDED_REWARD_FACTOR)
    const killExp = creditedKills * expRewardForLevel(monster.level) * expMultiplier * RARE_BLENDED_REWARD_FACTOR
    const damageExp =
      creditedDamage *
      ((expRewardForLevel(monster.level) * DAMAGE_EXP_SHARE) / monster.max_hp) *
      expMultiplier *
      RARE_BLENDED_DAMAGE_EXP_FACTOR
    expGained += Math.round(killExp + damageExp)
    // Feeds resolve_combat_apply_kill_counts as a fractional delta — see the
    // migration widening character_monster_kills/account_monster_kills.kills
    // to numeric, and this same value's use in the zone-tier layer below.
    killsThisWindow = creditedKills
  }

  // Idle/offline EXP rate (see IDLE_EXP_MULTIPLIER above) — applied once to
  // the whole window's total here, reassigning expGained in place so both the
  // level-up loop below and the response's own gained.exp reflect the real,
  // already-scaled amount rather than the pre-scaled live-equivalent.
  if (mode === 'offline') {
    expGained = Math.round(expGained * IDLE_EXP_MULTIPLIER)
  }

  // Level-up loop, capped at MAX_CHARACTER_LEVEL — mirrors
  // useProgressionStore.addRewards.
  let level = character.level
  let exp = character.exp
  if (level < MAX_CHARACTER_LEVEL) {
    exp += expGained
  }
  while (level < MAX_CHARACTER_LEVEL && exp >= requiredExpForLevel(level)) {
    exp -= requiredExpForLevel(level)
    level += 1
  }

  // Atomic increment (2026-08-11) — was a plain read-old-value-then-write-
  // absolute-total upsert (`characterKillsBefore + killsThisWindow`, from a
  // row read at the *start* of this function), the same "lost update" race
  // resolve_combat_apply_rewards was already fixed for below: two
  // resolve-combat calls for the same character landing close together (the
  // periodic interval call and an immediate call on stop/switch/
  // visibilitychange/beforeunload can easily overlap) would both read the
  // same starting kill count, and whichever finished last silently
  // discarded the other's kills. resolve_combat_apply_kill_counts does
  // `kills = kills + delta` as a single upsert, safe against any
  // interleaving. claimed_tier_index is untouched by this RPC — it's only
  // ever written by claim_kill_count_reward.
  let characterKillCount = characterKillsBefore
  let accountKillCount = accountKillsBefore

  if (killsThisWindow > 0) {
    const { data: killCountRow, error: killCountError } = await db
      .rpc('resolve_combat_apply_kill_counts', {
        p_character_id: characterId,
        p_account_id: character.account_id,
        p_monster_id: character.selected_monster_id,
        p_kills_delta: killsThisWindow,
      })
      .single()

    if (killCountError || !killCountRow) {
      console.error('resolve-combat resolve_combat_apply_kill_counts call failed:', killCountError?.message)
      // Falls back to the old (racy) locally-computed totals only if the RPC
      // itself somehow failed to return a row — keeps the response shape
      // intact rather than crashing, at the cost of reintroducing the race
      // for just this one call.
      characterKillCount = characterKillsBefore + killsThisWindow
      accountKillCount = accountKillsBefore + killsThisWindow
    } else {
      characterKillCount = Number(killCountRow.character_kills)
      accountKillCount = Number(killCountRow.account_kills)
    }
  }

  if (petObtained) {
    await db.from('account_pets').insert({ account_id: character.account_id, monster_id: character.selected_monster_id })
  }

  // Zone-level Achievements layer (2026-08-03, additive — see the migration's
  // own header). Recomputes this zone's total tier-completions across its
  // whole 5-monster roster (using the just-written characterKillCount for the
  // fought monster, fresh DB reads for the other 4) and grants any newly
  // crossed zone-tier reward exactly once, tracked via
  // character_zone_progress. Granted as Comet Scrolls (2026-08-07, was
  // Fallen Stars) straight through the atomic rewards RPC below —
  // unconditional, no Inventory-cap gating/Loot-Holding routing, same
  // "rare, deliberate, shouldn't silently fail" reasoning as the tier-6
  // Infused gear reward.
  let zoneCometScrollReward = 0
  if (killsThisWindow > 0 && monster.zone_id) {
    const { data: zoneMonsters } = await db.from('enemy_types').select('id').eq('zone_id', monster.zone_id)
    const zoneMonsterIds = (zoneMonsters ?? []).map((row) => row.id as string)

    const { data: zoneKillRows } = await db
      .from('character_monster_kills')
      .select('monster_id, kills')
      .eq('character_id', characterId)
      .in('monster_id', zoneMonsterIds)

    const killsByMonster: Record<string, number> = {}
    for (const row of zoneKillRows ?? []) {
      killsByMonster[row.monster_id as string] = row.kills as number
    }
    // Authoritative for the just-fought monster regardless of whether the
    // select above raced the upsert earlier in this function.
    killsByMonster[character.selected_monster_id] = characterKillCount

    const zoneMonsterKills = zoneMonsterIds.map((id) => killsByMonster[id] ?? 0)
    const { zoneTier } = zoneTierCompletions(zoneMonsterKills)

    // Fail-safe, not fail-open (2026-08-03, added after a real over-grant
    // incident — see 20260803040000_grant_service_role_zone_progress_access.sql):
    // a permission/query error here must NOT be treated the same as "no row
    // yet" (highestGranted = 0), or a missing grant silently re-grants this
    // zone's entire reward on every single call forever, live tick after
    // live tick. If the read itself fails, skip granting anything this call
    // rather than guessing — the next successful call will catch up
    // correctly once whatever's wrong is fixed.
    const { data: zoneProgressRow, error: zoneProgressError } = await db
      .from('character_zone_progress')
      .select('highest_zone_tier_granted')
      .eq('character_id', characterId)
      .eq('zone_id', monster.zone_id)
      .maybeSingle()

    if (zoneProgressError) {
      console.error('resolve-combat character_zone_progress read failed:', zoneProgressError.message)
    } else {
      const highestGranted = zoneProgressRow?.highest_zone_tier_granted ?? 0

      if (zoneTier > highestGranted) {
        for (let tier = highestGranted + 1; tier <= zoneTier; tier += 1) {
          zoneCometScrollReward += ZONE_TIER_COMET_SCROLL_REWARD[tier - 1]
        }
        const { error: zoneProgressWriteError } = await db
          .from('character_zone_progress')
          .upsert(
            { character_id: characterId, zone_id: monster.zone_id, highest_zone_tier_granted: zoneTier },
            { onConflict: 'character_id,zone_id' },
          )
        if (zoneProgressWriteError) {
          // zoneCometScrollReward is already computed by this point — logging
          // is what makes a future occurrence of this class of bug
          // diagnosable via the Dashboard's Logs tab, not silent.
          console.error('resolve-combat character_zone_progress write failed:', zoneProgressWriteError.message)
        }
      }
    }
  }

  interface GrantedItemRow {
    id: string
    template_id: string
    owner_id: string
    quality_tier: string
    level: number
    composition_level: number
    composition_points: number
    sockets: unknown[]
    enchant: unknown | null
    created_at: string
  }

  const itemsGranted: GrantedItemRow[] = []
  const itemsHeld: { template_id: string }[] = []
  const currencyHeld: { currency_type: 'comet' | 'fallen_star' }[] = []

  for (const template of droppedTemplates) {
    if (mode === 'live') {
      // droppedTemplates only ever contains items already confirmed to fit
      // at roll time for live mode (see above) — always goes straight into
      // Inventory. level starts at the template's own required_level (not
      // the schema default of 1) so a freshly-granted item's displayed level
      // honestly reflects which tier it actually is.
      const { data: inserted } = await db
        .from('item_instances')
        .insert({ template_id: template.id, owner_id: characterId, level: template.required_level, quality_tier: template.qualityTier })
        .select('*')
        .single()
      occupied += 1
      if (inserted) itemsGranted.push(inserted)
    } else if (heldCount < LOOT_HOLDING_CAP) {
      // Offline/idle catch-up always routes to Loot Holding, never straight
      // into Inventory, regardless of whether Inventory happened to have
      // room (confirmed with the user, 2026-08-01 — supersedes the earlier
      // "only overflows to Loot Holding once Inventory is full" behavior) —
      // so an idle session never silently rearranges the player's bag while
      // they're away; everything gets reviewed via Loot Holding on return.
      await db
        .from('loot_holding')
        .insert({ character_id: characterId, template_id: template.id, quality_tier: template.qualityTier })
      heldCount += 1
      itemsHeld.push({ template_id: template.id })
    }
    // else: genuinely lost — offline only, Loot Holding itself is full too.
  }

  // Comets/Fallen Stars are individual, non-stacking Inventory items — each
  // gained unit competes for the same 40-slot cap as gear. Live mode grants
  // straight into the character's own count (already confirmed to fit at
  // roll time — see the mirror-image reasoning above for gear); offline mode
  // always routes to Loot Holding instead, same "never silently rearrange
  // the bag while the player's away" rule the gear loop above now follows.
  // (zoneCometScrollReward, if any, is granted separately below via the
  // atomic rewards RPC — unconditional, not folded into this loop, since
  // loot_holding's currency_type doesn't model Scrolls.)

  let cometsToGrant = 0
  for (let i = 0; i < cometsGained; i += 1) {
    if (mode === 'live') {
      cometsToGrant += 1
      occupied += 1
    } else if (heldCount < LOOT_HOLDING_CAP) {
      await db.from('loot_holding').insert({ character_id: characterId, currency_type: 'comet' })
      heldCount += 1
      currencyHeld.push({ currency_type: 'comet' })
    }
  }

  let fallenStarsToGrant = 0
  for (let i = 0; i < fallenStarsGained; i += 1) {
    if (mode === 'live') {
      fallenStarsToGrant += 1
      occupied += 1
    } else if (heldCount < LOOT_HOLDING_CAP) {
      await db.from('loot_holding').insert({ character_id: characterId, currency_type: 'fallen_star' })
      heldCount += 1
      currencyHeld.push({ currency_type: 'fallen_star' })
    }
  }

  // Atomic, not a read-modify-write blanket overwrite (fixed 2026-08-05,
  // reported by the user: "I tried to Bundle some comets in the shop
  // interface. They bundled but then the action reversed"). The old version
  // of this wrote `character.gold + goldGained`/`character.comet_count +
  // cometsToGrant` — plain JS-computed values from the `character` row read
  // once at the very start of this call — via a single `.update({...})`. If
  // anything else touched gold/comet_count/fallen_star_count on this same
  // row in between (bundle_currency_scroll, sell_item, a Forge upgrade's
  // comet/fallen-star cost, ...), that change was silently clobbered back to
  // this stale snapshot the moment this call's own write landed — a lost
  // update, not a display glitch. `resolve_combat_apply_rewards` (see its
  // own migration) does the increment as a single `column = column + delta`
  // SQL statement instead, which Postgres guarantees is safe against any
  // concurrent writer to the same row, no matter how the two calls interleave.
  const { data: rewardRow, error: rewardError } = await db
    .rpc('resolve_combat_apply_rewards', {
      p_character_id: characterId,
      p_gold_delta: goldGained,
      p_exp: exp,
      p_level: level,
      p_comet_delta: cometsToGrant,
      p_fallen_star_delta: fallenStarsToGrant,
      p_comet_scroll_delta: zoneCometScrollReward,
      p_resolved_at: new Date(now).toISOString(),
    })
    .single()

  if (rewardError || !rewardRow) {
    console.error('resolve-combat resolve_combat_apply_rewards call failed:', rewardError?.message)
  }

  // Falls back to the old (racy) JS-computed values only if the RPC itself
  // somehow failed to return a row — keeps the response shape intact rather
  // than crashing, at the cost of reintroducing the race for just this one
  // call; the RPC's own row-not-found case would mean characterId itself was
  // bad, which every earlier query in this function would already have
  // caught.
  const newGold = rewardRow?.gold ?? character.gold + goldGained
  const newComets = rewardRow?.comet_count ?? character.comet_count + cometsToGrant
  const newFallenStars = rewardRow?.fallen_star_count ?? character.fallen_star_count + fallenStarsToGrant
  const newCometScrolls = rewardRow?.comet_scroll_count ?? character.comet_scroll_count + zoneCometScrollReward

  return json({
    ok: true,
    elapsedMs,
    // Deltas — for display/toast purposes only (combat-log flavor text).
    // Deliberately the full rolled amount (cometsGained/fallenStarsGained),
    // not just what actually fit in Inventory — matches how gear drops'
    // flavor text isn't reduced either when a drop overflows to Loot Holding.
    gained: { kills, rareKills, gold: goldGained, exp: expGained, comets: cometsGained, fallenStars: fallenStarsGained },
    // Absolute, authoritative new totals — this is what the client reconciles
    // its local state to (replace, not add — see useProgressionStore's
    // applyServerCombatResult).
    character: {
      gold: newGold,
      exp,
      level,
      comets: newComets,
      fallenStars: newFallenStars,
      cometScrolls: newCometScrolls,
    },
    leveledUp: level > character.level,
    itemsGranted,
    itemsHeld,
    currencyHeld,
    inventoryFull,
    // Achievements & Pets, Stage 1 — this monster's updated kill totals (so
    // the client can reflect them without a refetch, same pattern as gold/
    // exp/comets), and the monster id if a pet was newly obtained this call.
    monsterId: character.selected_monster_id,
    characterKillCount,
    accountKillCount,
    petObtained: petObtained ? character.selected_monster_id : null,
  })
}
