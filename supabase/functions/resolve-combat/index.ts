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
// KNOWN DUPLICATION, ACCEPTED: the math below (rare rolls, HP/reward scaling,
// the EXP curve, the simplified Attack-vs-Defense damage formula, Meteor/
// DragonBall odds) mirrors src/game/combat/combatResolver.ts and
// src/game/stats/{derivedStats,classes,useProgressionStore}.ts and
// src/game/items/equipmentBonus.ts almost line-for-line. Deno can't cleanly
// import those files directly (they're resolved by Vite without file
// extensions, which Deno's module resolution doesn't do) without an import
// map, so this is a deliberate, disclosed copy — the same "must stay in sync"
// relationship this codebase already has elsewhere (e.g. forgeCosts.ts's
// preview functions vs. their SQL counterparts). If any of those formulas
// change, mirror the change here too.

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
  // outgoing hit chance only (see rollAttackLands).
  const dexterity = attributes.agility * 1 + (equipmentBonus.dexterity ?? 0)
  return { hp, physicalAttack, magicAttack, attackSpeed: BASE_ATTACK_SPEED, dexterity }
}

// Mirrors src/game/items/equipmentBonus.ts (recalibrated 2026-07-31 — 1 + weight/4
// using the confirmed battle-power weighting, was a stale 1/1.1/1.2/1.35/1.5 that
// never got updated here when the client-side constant changed).
const QUALITY_STAT_MULTIPLIERS: Record<string, number> = {
  normal: 1,
  refined: 1.25,
  unique: 1.5,
  elite: 1.75,
  super: 2,
}

function scaledStat(baseStats: Record<string, number>, key: string, qualityTier: string): number | undefined {
  const base = baseStats[key]
  if (typeof base !== 'number') return undefined
  return Math.round(base * (QUALITY_STAT_MULTIPLIERS[qualityTier] ?? 1))
}

// Mirrors src/game/combat/combatResolver.ts
const RARE_CHANCE = 0.05
const RARE_HP_MULTIPLIER = 2
const RARE_REWARD_MULTIPLIER = 5
const MIN_DAMAGE_PERCENT_OF_ATTACK = 0.1
// Min/max hit range (see combatResolver.ts's mirror) — ±50% around the
// midpoint, matching the real reference data's Iron Ring (min 1/max 3 at
// midpoint 2).
const DAMAGE_ROLL_MIN_RATIO = 0.5
const DAMAGE_ROLL_MAX_RATIO = 1.5
const METEOR_DROP_CHANCE = 1 / 500
const DRAGONBALL_DROP_CHANCE = 1 / 20000
// Gear drop rate + per-drop quality odds (confirmed with the user,
// 2026-08-01) — supersedes the earlier flat 10%-per-kill/always-Normal-
// quality placeholder. A drop itself is now genuinely rare on its own; the
// quality of that drop is then a separate, much rarer roll layered on top
// (checked rarest-first, first hit wins, otherwise Normal) rather than every
// drop defaulting to Normal — Quality Upgrade in the Forge is no longer the
// only way to ever see a non-Normal item. Mirrored client-side in
// useInventoryStore.ts's DROP_CHANCE (that copy is predictive-only — combat
// log flavor text — so it doesn't need the quality roll, just the rate).
const DROP_CHANCE = 1 / 150
const QUALITY_DROP_CHANCES: [tier: string, chance: number][] = [
  ['super', 1 / 15000],
  ['elite', 1 / 5000],
  ['unique', 1 / 2000],
  ['refined', 1 / 500],
]

function rollDroppedQualityTier(): string {
  for (const [tier, chance] of QUALITY_DROP_CHANCES) {
    if (Math.random() < chance) return tier
  }
  return 'normal'
}

// Achievements & Pets (confirmed shape, see CLAUDE.md — the tracking
// mechanism is real, the reward VALUES below are a deliberate uniform
// placeholder until real per-monster/per-zone tier content is designed; do
// not treat these numbers as final). Mirrors
// src/game/achievements/achievementData.ts — keep in sync.
const ACHIEVEMENT_TIERS = [100, 250, 500, 1000, 5000, 10000]

// Corrected (2026-08-03, confirmed with the user) — supersedes the previous
// "Kill Count and Prestige both grant gold, stacking multiplicatively"
// design. Prestige (renamed from "Unlock") now solely owns the yield/
// kill-rate reward category — this is the only gold multiplier left. Kill
// Count's own reward moved to a separate, non-gold category (a bonus-
// currency-drop-chance multiplier, see KILL_COUNT_BONUS_DROP_MULTIPLIER
// below) — "other bonuses," per the user's own framing, distinct from
// Prestige's yield/rate role. Same table (PLACEHOLDER, highest tier reached
// wins, not cumulative) reused for both, since both still escalate across
// the same 6 tiers uniformly across every monster.
const ACHIEVEMENT_GOLD_MULTIPLIER: Record<number, number> = {
  100: 1.05,
  250: 1.1,
  500: 1.2,
  1000: 1.35,
  5000: 1.5,
  10000: 2,
}

// Kill Count's own reward category (2026-08-03) — a bonus multiplier on the
// per-kill Meteor/DragonBall drop chance (see rollBonusCurrencyDrops below),
// scaled by the highest Kill Count tier reached for the monster being
// fought. PLACEHOLDER magnitudes, same "highest tier wins" shape as the gold
// table above.
const KILL_COUNT_BONUS_DROP_MULTIPLIER: Record<number, number> = {
  100: 1.1,
  250: 1.25,
  500: 1.5,
  1000: 2,
  5000: 3,
  10000: 5,
}

// Confirmed, not a placeholder — 1/5000 chance per kill, independent of every
// other roll this function makes.
const PET_DROP_CHANCE = 1 / 5000

// Zone-level Achievements layer (2026-08-03, confirmed with the user,
// additive to the per-monster system above, not a replacement — see the
// migration's own header for the full write-up). Every zone has exactly 5
// monsters (confirmed by CLAUDE.md's Zones section), so 5 monsters x 6 tiers
// = 30 possible tier-milestones per zone, uniformly — this even 6-step
// ladder (5/10/15/20/25/30) mirrors every other tier system in this game.
// DragonBall reward per zone tier, PLACEHOLDER, escalating — "gives you a
// DragonBall or something," per the user's own framing.
const ZONE_TIER_COMPLETIONS = [5, 10, 15, 20, 25, 30]
const ZONE_TIER_DRAGONBALL_REWARD = [1, 2, 3, 4, 5, 8]

// Every tier now costs something to unlock (confirmed with the user,
// 2026-08-01 — supersedes the original "first 3 free, pay once for the rest"
// design), paid one at a time in order via unlock_next_achievement_tier.
// unlockedTierIndex counts how many of the 6 tiers, in order, have been
// unlocked so far. Renamed prestigeGoldMultiplier (2026-08-03, "Unlocks" is
// now called "Prestige" everywhere) — mirrors
// src/game/achievements/achievementData.ts's own function of the same name.
function prestigeGoldMultiplier(unlockedTierIndex: number): number {
  let multiplier = 1
  for (let i = 0; i < unlockedTierIndex; i += 1) {
    multiplier = ACHIEVEMENT_GOLD_MULTIPLIER[ACHIEVEMENT_TIERS[i]]
  }
  return multiplier
}

function killCountBonusDropMultiplier(kills: number): number {
  let multiplier = 1
  for (const tier of ACHIEVEMENT_TIERS) {
    if (kills >= tier) {
      multiplier = KILL_COUNT_BONUS_DROP_MULTIPLIER[tier]
    }
  }
  return multiplier
}

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

interface EnemyType {
  level: number
  max_hp: number
  gold_reward: number
  exp_reward: number
  attack_damage: number
}

function rollIsRare(): boolean {
  return Math.random() < RARE_CHANCE
}

function spawnMonsterHp(type: EnemyType, isRare: boolean): number {
  return isRare ? type.max_hp * RARE_HP_MULTIPLIER : type.max_hp
}

function killRewards(type: EnemyType, isRare: boolean, characterLevel: number) {
  const rareMultiplier = isRare ? RARE_REWARD_MULTIPLIER : 1
  const expMultiplier = EXP_MULTIPLIER_BY_COLOR[getLevelDiffColor(characterLevel, type.level)]
  return {
    gold: type.gold_reward * rareMultiplier,
    exp: Math.round(type.exp_reward * rareMultiplier * expMultiplier),
  }
}

function monsterDefense(type: EnemyType): number {
  return Math.round(type.level * 1.5)
}

// Mirrors combatResolver.ts's monsterDodge/rollAttackLands (2026-08-02) —
// must stay in sync. This one matters here, unlike incoming dodge/defense:
// it changes whether a simulated attack actually lands a hit at all, which
// directly affects kills/rewards for this window, not just player HP (which
// still isn't simulated server-side).
const DODGE_CHANCE_PER_POINT = 0.005
const MAX_DODGE_CHANCE = 0.5

function monsterDodge(type: EnemyType): number {
  return Math.round(type.level * 0.8)
}

function rollAttackLands(playerDexterity: number, monsterDodgeValue: number): boolean {
  const missChance = Math.min(Math.max(0, monsterDodgeValue - playerDexterity) * DODGE_CHANCE_PER_POINT, MAX_DODGE_CHANCE)
  return Math.random() >= missChance
}

function resolvePhysicalDamage(attack: number, defense: number): number {
  const mitigated = attack - defense
  const floor = Math.round(attack * MIN_DAMAGE_PERCENT_OF_ATTACK)
  return Math.max(mitigated, floor, 1)
}

function rollDamageInRange(midpoint: number): number {
  const min = Math.max(1, Math.round(midpoint * DAMAGE_ROLL_MIN_RATIO))
  const max = Math.max(min, Math.round(midpoint * DAMAGE_ROLL_MAX_RATIO))
  return min + Math.floor(Math.random() * (max - min + 1))
}

// bonusDropMultiplier — Kill Count's own reward (see
// KILL_COUNT_BONUS_DROP_MULTIPLIER above), applied to both chances alike.
function rollBonusCurrencyDrops(bonusDropMultiplier: number) {
  return {
    meteors: Math.random() < METEOR_DROP_CHANCE * bonusDropMultiplier ? 1 : 0,
    dragonballs: Math.random() < DRAGONBALL_DROP_CHANCE * bonusDropMultiplier ? 1 : 0,
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

// Bounded elapsed-time window, shared by live (~15s calls) and offline (up to
// this cap) resolution — mirrors offlineProgress.ts's MAX_OFFLINE_MS.
const MAX_RESOLVE_WINDOW_MS = 2 * 60 * 60 * 1000

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
      'id, account_id, class, level, gold, exp, meteor_count, dragonball_count, meteor_scroll_count, dragonball_scroll_count, equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id, equipped_hat_id, equipped_coat_id, equipped_quiver_id, selected_monster_id, combat_last_resolved_at',
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
  const elapsedMs = Math.min(Math.max(now - lastResolvedMs, 0), MAX_RESOLVE_WINDOW_MS)

  // Nothing selected to fight — just advance the clock so a later resolve
  // doesn't get an inflated window once a monster IS selected.
  if (!character.selected_monster_id) {
    await db.from('characters').update({ combat_last_resolved_at: new Date(now).toISOString() }).eq('id', characterId)
    return json({
      ok: true,
      elapsedMs,
      gained: { kills: 0, rareKills: 0, gold: 0, exp: 0, meteors: 0, dragonballs: 0 },
      character: {
        gold: character.gold,
        exp: character.exp,
        level: character.level,
        meteors: character.meteor_count,
        dragonballs: character.dragonball_count,
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
  // monster Dodge (see rollAttackLands below), which affects real kill
  // counts/rewards, unlike incoming mitigation.
  const attributes = getAttributesForLevel(character.class ?? 'hunter', character.level)
  const equipmentBonus: { physicalAttack: number; magicAttack: number; dexterity: number } = {
    physicalAttack: 0,
    magicAttack: 0,
    dexterity: 0,
  }

  const equippedItemIds = [
    character.equipped_weapon_id,
    character.equipped_ring_id,
    character.equipped_necklace_id,
    character.equipped_boots_id,
    character.equipped_hat_id,
    character.equipped_coat_id,
  ].filter((id): id is string => Boolean(id))

  if (equippedItemIds.length > 0) {
    const { data: equippedItems } = await db.from('item_instances').select('id, quality_tier, template_id').in('id', equippedItemIds)

    if (equippedItems && equippedItems.length > 0) {
      const { data: equippedTemplates } = await db
        .from('item_templates')
        .select('id, base_stats')
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
      }
    }
  }

  const derived = computeDerivedStats(attributes, equipmentBonus)
  const attackIntervalMs = 1000 / derived.attackSpeed
  const attackMidpoint = derived.physicalAttack + derived.magicAttack

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
  let meteorsGained = 0
  let dragonballsGained = 0
  // Live mode only (confirmed with the user, 2026-07-31): set the moment a
  // kill rolls a drop that can't fit, at which point the whole simulated
  // window stops right there rather than continuing to fight and stashing
  // the overflow in Loot Holding — "a full inventory should stop combat."
  // Loot Holding is now exclusively for the offline/idle catch-up window
  // (surfaced in OfflineProgressModal, not a persistent Warehouse card).
  let inventoryFull = false
  const droppedTemplates: { id: string; required_level: number; qualityTier: string }[] = []

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
  ] = await Promise.all([
    db.from('item_instances').select('id', { count: 'exact', head: true }).eq('owner_id', characterId),
    db.from('characters').select('composition_stones').eq('id', characterId).maybeSingle(),
    db.from('loot_holding').select('id', { count: 'exact', head: true }).eq('character_id', characterId),
    db.from('potion_stacks').select('id', { count: 'exact', head: true }).eq('character_id', characterId).gt('count', 0),
    // Achievements & Pets, Stage 1 — this monster's existing kill-count rows
    // (both ladders) and whether its pet is already obtained account-wide.
    // Fetched here, alongside the other per-request baselines, rather than a
    // separate round-trip.
    db
      .from('character_monster_kills')
      .select('kills, unlocked_tier_index')
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
  ])

  // Gold multiplier is fixed for the whole simulated window, computed from the
  // tier reached BEFORE this window's kills — same simplification already
  // established for the level-diff EXP multiplier in the offline simulator,
  // not a claim of new precision.
  const characterKillsBefore = characterKillsRow?.kills ?? 0
  const unlockedTierIndex = characterKillsRow?.unlocked_tier_index ?? 0
  const accountKillsBefore = accountKillsRow?.kills ?? 0
  const petAlreadyUnlocked = Boolean(petRow)
  // Prestige owns gold/yield; Kill Count owns its own separate bonus-currency-
  // drop-chance multiplier (2026-08-03, see the constants above) — no longer
  // stacked into one combined gold multiplier.
  const achievementGoldMultiplier = prestigeGoldMultiplier(unlockedTierIndex)
  const bonusDropMultiplier = killCountBonusDropMultiplier(characterKillsBefore)
  let killsThisWindow = 0
  let petObtained = false

  const stoneSlotCount = Object.values((composition?.composition_stones as Record<string, number>) ?? {}).reduce(
    (sum, v) => sum + (typeof v === 'number' ? v : 0),
    0,
  )
  // Bug fix (2026-07-31): this baseline previously omitted potions and the
  // character's own already-owned Meteor/DragonBall/Scroll counts entirely —
  // it only ever counted gear + stones, silently under-counting real
  // Inventory fullness (see CLAUDE.md's Warehouse economy redesign note,
  // stage 2 — caught while adding Scroll accounting here). Mirrors
  // useInventoryStore.occupiedSlotCount's client-side formula in full now.
  let occupied =
    (gearCount ?? 0) +
    stoneSlotCount +
    (potionCount ?? 0) +
    character.meteor_count +
    character.dragonball_count +
    character.meteor_scroll_count +
    character.dragonball_scroll_count
  let heldCount = holdingCount ?? 0
  // Live mode only — a running projection of `occupied` as this window's
  // kills are simulated, so a mid-window fit-check can be made without
  // mutating the real `occupied` the post-loop granting pass still uses.
  // The two never disagree (both start from the same baseline and increment
  // by the same items in the same order), so the post-loop pass never needs
  // its own live/offline branch — for live mode, anything in
  // droppedTemplates/meteorsGained/dragonballsGained was already confirmed
  // to fit at roll time, so occupied is guaranteed to still have room when
  // the post-loop pass reaches it.
  let projectedOccupied = occupied

  if (totalAttacks > 0) {
    // Fetched once (not per-roll) and reused for every drop this window rolls
    // — level-appropriate selection (confirmed with the user, 2026-07-30):
    // picks a random gear family available to the character's class
    // (excluding the standalone 'sword' family — the legacy Wooden Sword
    // freebie isn't meant to drop from monsters — and 'quiver', a starter/
    // shop-only item for the same reason), then the template in that family
    // whose required_level is closest to the monster's own level. Mirrors
    // pickLevelAppropriateTemplate in useInventoryStore.ts — must stay in
    // sync, same pattern as this file's other client/server mirrors.
    const { data: dropPool } = await db
      .from('item_templates')
      .select('id, required_level, item_family, required_class')
      .not('item_family', 'in', '("sword","quiver","lucky-bow")')

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

    let isRare = rollIsRare()
    let hp = spawnMonsterHp(monster, isRare)

    for (let i = 0; i < totalAttacks; i += 1) {
      // Outgoing hit-chance roll (2026-08-02, confirmed design) — mirrors
      // useCombatStore.runTick's client-side check. A miss consumes this
      // attack (still counts toward totalAttacks/elapsed time) but deals no
      // damage — matches the client exactly rather than an expected-value
      // approximation, same reasoning as the per-attack damage roll below.
      if (!rollAttackLands(derived.dexterity, monsterDodge(monster))) {
        continue
      }

      // Rolled independently per attack (see rollDamageInRange) rather than
      // a single precomputed value reused every iteration, so the offline/
      // idle simulation matches live combat's per-hit variance exactly
      // instead of falling back to an expected-value approximation.
      const damage = resolvePhysicalDamage(rollDamageInRange(attackMidpoint), monsterDefense(monster))
      hp -= damage

      if (hp <= 0) {
        kills += 1
        if (isRare) rareKills += 1

        // Achievements & Pets, Stage 1 — mode-agnostic (kill counts accrue
        // identically in live and offline, same as kills/goldGained already
        // do). Pet roll stops as soon as it hits once per window, matching
        // "once obtained, no character can ever roll it again."
        killsThisWindow += 1
        if (!petAlreadyUnlocked && !petObtained && Math.random() < PET_DROP_CHANCE) {
          petObtained = true
        }

        const rewards = killRewards(monster, isRare, character.level)
        goldGained += rewards.gold
        expGained += rewards.exp

        if (Math.random() < DROP_CHANCE) {
          const dropped = pickDropTemplate()
          if (dropped) {
            // Quality is rolled once, at drop time, and carried with the
            // template through to whichever table (item_instances or
            // loot_holding) ends up actually receiving it below.
            const withQuality = { ...dropped, qualityTier: rollDroppedQualityTier() }
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

        const bonusCurrency = rollBonusCurrencyDrops(bonusDropMultiplier)
        if (mode === 'live') {
          if (bonusCurrency.meteors > 0) {
            if (projectedOccupied < INVENTORY_SLOT_CAP) {
              meteorsGained += bonusCurrency.meteors
              projectedOccupied += 1
            } else {
              inventoryFull = true
            }
          }
          if (bonusCurrency.dragonballs > 0) {
            if (projectedOccupied < INVENTORY_SLOT_CAP) {
              dragonballsGained += bonusCurrency.dragonballs
              projectedOccupied += 1
            } else {
              inventoryFull = true
            }
          }
        } else {
          meteorsGained += bonusCurrency.meteors
          dragonballsGained += bonusCurrency.dragonballs
        }

        // Live mode stops the whole window right here — this kill's own
        // gold/EXP still count (already accumulated above), it's just the
        // rest of the window that never happens, matching "you'd have
        // stopped fighting the moment you couldn't carry any more loot."
        if (mode === 'live' && inventoryFull) {
          break
        }

        isRare = rollIsRare()
        hp = spawnMonsterHp(monster, isRare)
      }
    }
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

  // Achievements & Pets, Stage 1 — the gold multiplier is a constant for the
  // whole window (computed above from the pre-window kill count), so applying
  // it once to the total is mathematically identical to applying it per kill.
  goldGained = Math.round(goldGained * achievementGoldMultiplier)

  const characterKillCount = characterKillsBefore + killsThisWindow
  const accountKillCount = accountKillsBefore + killsThisWindow

  if (killsThisWindow > 0) {
    await Promise.all([
      db
        .from('character_monster_kills')
        .upsert(
          {
            character_id: characterId,
            monster_id: character.selected_monster_id,
            kills: characterKillCount,
            unlocked_tier_index: unlockedTierIndex,
          },
          { onConflict: 'character_id,monster_id' },
        ),
      db
        .from('account_monster_kills')
        .upsert(
          { account_id: character.account_id, monster_id: character.selected_monster_id, kills: accountKillCount },
          { onConflict: 'account_id,monster_id' },
        ),
    ])
  }

  if (petObtained) {
    await db.from('account_pets').insert({ account_id: character.account_id, monster_id: character.selected_monster_id })
  }

  // Zone-level Achievements layer (2026-08-03, additive — see the migration's
  // own header). Recomputes this zone's total tier-completions across its
  // whole 5-monster roster (using the just-written characterKillCount for the
  // fought monster, fresh DB reads for the other 4) and grants any newly
  // crossed zone-tier DragonBall reward exactly once, tracked via
  // character_zone_progress. Folded into dragonballsGained below (right
  // before the existing per-unit grant loop) rather than granted separately,
  // so it goes through the exact same live-mode-room-check/offline-Loot-
  // Holding routing a dropped DragonBall already does — no special-casing.
  let zoneDragonballReward = 0
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

    const { data: zoneProgressRow } = await db
      .from('character_zone_progress')
      .select('highest_zone_tier_granted')
      .eq('character_id', characterId)
      .eq('zone_id', monster.zone_id)
      .maybeSingle()

    const highestGranted = zoneProgressRow?.highest_zone_tier_granted ?? 0

    if (zoneTier > highestGranted) {
      for (let tier = highestGranted + 1; tier <= zoneTier; tier += 1) {
        zoneDragonballReward += ZONE_TIER_DRAGONBALL_REWARD[tier - 1]
      }
      await db
        .from('character_zone_progress')
        .upsert(
          { character_id: characterId, zone_id: monster.zone_id, highest_zone_tier_granted: zoneTier },
          { onConflict: 'character_id,zone_id' },
        )
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
  const currencyHeld: { currency_type: 'meteor' | 'dragonball' }[] = []

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

  // Meteors/DragonBalls are individual, non-stacking Inventory items — each
  // gained unit competes for the same 40-slot cap as gear. Live mode grants
  // straight into the character's own count (already confirmed to fit at
  // roll time — see the mirror-image reasoning above for gear); offline mode
  // always routes to Loot Holding instead, same "never silently rearrange
  // the bag while the player's away" rule the gear loop above now follows.
  // Zone Achievement DragonBall reward (if any) folds in here, right before
  // the grant loop, so it's treated exactly like a dropped DragonBall for
  // inventory-cap purposes — see the zoneDragonballReward computation above.
  dragonballsGained += zoneDragonballReward

  let meteorsToGrant = 0
  for (let i = 0; i < meteorsGained; i += 1) {
    if (mode === 'live') {
      meteorsToGrant += 1
      occupied += 1
    } else if (heldCount < LOOT_HOLDING_CAP) {
      await db.from('loot_holding').insert({ character_id: characterId, currency_type: 'meteor' })
      heldCount += 1
      currencyHeld.push({ currency_type: 'meteor' })
    }
  }

  let dragonballsToGrant = 0
  for (let i = 0; i < dragonballsGained; i += 1) {
    if (mode === 'live') {
      dragonballsToGrant += 1
      occupied += 1
    } else if (heldCount < LOOT_HOLDING_CAP) {
      await db.from('loot_holding').insert({ character_id: characterId, currency_type: 'dragonball' })
      heldCount += 1
      currencyHeld.push({ currency_type: 'dragonball' })
    }
  }

  const newMeteors = character.meteor_count + meteorsToGrant
  const newDragonballs = character.dragonball_count + dragonballsToGrant

  await db
    .from('characters')
    .update({
      gold: character.gold + goldGained,
      exp,
      level,
      meteor_count: newMeteors,
      dragonball_count: newDragonballs,
      combat_last_resolved_at: new Date(now).toISOString(),
    })
    .eq('id', characterId)

  return json({
    ok: true,
    elapsedMs,
    // Deltas — for display/toast purposes only (combat-log flavor text).
    // Deliberately the full rolled amount (meteorsGained/dragonballsGained),
    // not just what actually fit in Inventory — matches how gear drops'
    // flavor text isn't reduced either when a drop overflows to Loot Holding.
    gained: { kills, rareKills, gold: goldGained, exp: expGained, meteors: meteorsGained, dragonballs: dragonballsGained },
    // Absolute, authoritative new totals — this is what the client reconciles
    // its local state to (replace, not add — see useProgressionStore's
    // applyServerCombatResult).
    character: {
      gold: character.gold + goldGained,
      exp,
      level,
      meteors: newMeteors,
      dragonballs: newDragonballs,
    },
    leveledUp: level > character.level,
    itemsGranted,
    itemsHeld,
    currencyHeld,
    inventoryFull,
    // Achievements & Pets, Stage 1 — this monster's updated kill totals (so
    // the client can reflect them without a refetch, same pattern as gold/
    // exp/meteors), and the monster id if a pet was newly obtained this call.
    monsterId: character.selected_monster_id,
    characterKillCount,
    accountKillCount,
    petObtained: petObtained ? character.selected_monster_id : null,
  })
}
