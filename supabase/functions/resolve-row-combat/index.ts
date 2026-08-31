// Row Combat — Phase 1 (see notes/ for the design plan this was built
// from). A new, LIVE-ONLY sibling to resolve-combat/index.ts, following the
// same "new sibling function when the state shape is different enough"
// precedent world-boss-attack/index.ts already set. Row combat's state (up
// to 12 concurrent, independently-timed enemy slots per character) doesn't
// share resolve-combat's single-monster closed-form shape, and Deno can't
// import the client's TS math either way — so this is a deliberate,
// disclosed copy of the same duplicated blocks resolve-combat/index.ts
// already carries (attribute anchors, computeDerivedStats, quality/
// composition/gem bonus math, resolvePhysicalDamage, monsterDefense/
// monsterDodge, drop-rate tables, the EXP curve) — mirror any change to
// those files here too.
//
// Row slots are ABILITY/PASSIVE-ONLY targets — there is no basic
// auto-attack against them (2026-08-17, requested by the user: with 6
// slots to auto-target across, plain auto-attack alone was clearing Row 1
// fast enough that Multi-Shot barely mattered). The only things that ever
// deal real damage to a row slot are Multi-Shot (below) and, eventually,
// other abilities/passives — never a periodic per-window formula the way
// single-target combat's own closed-form reward math is. A plain resolve
// call (fireMultiShot: false) only processes respawns that came due; a
// fireMultiShot: true call applies one REAL rolled hit (see
// rollDamageInRange below, and MULTI_SHOT_DAMAGE_MULTIPLIER for the 50%
// per-target reduction, both 2026-08-17) to every enabled+alive slot,
// directly against a slot's own real, continuously-tracked current_hp —
// deliberately NOT the deterministic expected-value math single-target
// combat's continuous per-window formula uses, since Multi-Shot is a
// discrete, single, player-pressed action (closer to World Boss's "one
// real, immediately server-resolved attempt" than to a periodic tick) —
// see rollDamageInRange's own comment for why real RNG here doesn't
// reintroduce the divergence problem the 2026-08-11 rewrite fixed. This
// server function is the SOLE source of real rewards; the client's own
// row tick loop (attack-back, respawn countdown) is prediction/cosmetic-
// only, and Multi-Shot's actual hit/miss/damage numbers are only ever
// shown once this function's response arrives (multiShotHits below).
//
// Monster attack-back is deliberately NOT simulated here — mirrors
// resolve-combat's own existing, documented gap ("player HP has never been
// simulated server-side"). Row combat's attack-back is client-only,
// applied against the SAME shared player-HP state single-target combat
// uses (see useCombatStore.ts's applyIncomingDamage). Gear durability decay
// is also deliberately skipped here (unlike resolve-combat) — row combat's
// windows are always <=10s, a negligible fraction of the 18h-to-empty decay
// budget, not worth the added complexity for this phase.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

// ---------------------------------------------------------------------------
// Shared math, copied from resolve-combat/index.ts — keep in sync with that
// file (and with the client's own combatResolver.ts/classes.ts/
// derivedStats.ts/equipmentBonus.ts, which resolve-combat itself mirrors).
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
    if (clampedLevel === anchorLevel) return { ...anchorAttrs }
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
  const dexterity = attributes.agility * 1 + (equipmentBonus.dexterity ?? 0)
  return { hp, physicalAttack, magicAttack, attackSpeed: BASE_ATTACK_SPEED, dexterity }
}

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

// Raised 5% -> 10% (2026-11) — must stay in sync with equipmentBonus.ts.
const COMPOSITION_BONUS_PCT_PER_TIER = 0.1
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

const GEM_PERCENT_BY_TIER: Record<'drake' | 'ember' | 'iris', Record<string, number>> = {
  drake: { normal: 5, tempered: 10, ascended: 15 },
  ember: { normal: 5, tempered: 10, ascended: 15 },
  iris: { normal: 5, tempered: 10, ascended: 15 },
}

function sumSocketedGemBonusPct(sockets: (string | null)[] | undefined, gemId: 'drake' | 'ember' | 'iris'): number {
  let total = 0
  for (const socket of sockets ?? []) {
    if (!socket) continue
    const match = /^(drake|ember|bastion|iris)_(normal|tempered|ascended)$/.exec(socket)
    if (!match || match[1] !== gemId) continue
    total += GEM_PERCENT_BY_TIER[gemId][match[2]] ?? 0
  }
  return total
}

const RARE_CHANCE = 0.05
const RARE_HP_MULTIPLIER = 2
const RARE_REWARD_MULTIPLIER = 5
const MIN_DAMAGE_PERCENT_OF_ATTACK = 0.1
const RARE_BLENDED_REWARD_FACTOR = (1 - RARE_CHANCE) + RARE_CHANCE * RARE_REWARD_MULTIPLIER // 1.2
const RARE_BLENDED_DAMAGE_EXP_FACTOR = (1 - RARE_CHANCE) + RARE_CHANCE * (RARE_REWARD_MULTIPLIER / RARE_HP_MULTIPLIER) // 1.075

// Row Combat-specific rates. COMET_DROP_CHANCE/FALLEN_STAR_DROP_CHANCE stay
// deliberately 4x single-target's own values (confirmed with the user
// 2026-08-20, a Row Combat-only buff, not a global rebalance) — untouched by
// the 2026-09 drop-rate pass below.
//
// DROP_CHANCE/QUALITY_DROP_CHANCES relationship changed 2026-09 (requested by
// the user alongside that same pass): DROP_CHANCE is now HALF single-target's
// own DROP_CHANCE (was 4x) — 1/50 / 2 = 1/100 — and QUALITY_DROP_CHANCES is
// now identical to single-target's own table, not its own separately-scaled
// copy. Both must be kept in that relationship if resolve-combat/index.ts's
// own DROP_CHANCE/QUALITY_DROP_CHANCES change again.
const COMET_DROP_CHANCE = 1 / 125
const FALLEN_STAR_DROP_CHANCE = 1 / 5000
const DROP_CHANCE = 1 / 100
const JADE_SHARD_DROP_CHANCE = 1 / 300
const JADE_SHARD_MONSTER_IDS = ['frostpelt', 'venomkin', 'dunecrawler']
const PET_DROP_CHANCE = 1 / 25000

const QUALITY_DROP_CHANCES: [tier: string, chance: number][] = [
  ['ascended', 1 / 200],
  ['radiant', 1 / 100],
  ['infused', 3 / 100],
  ['tempered', 3 / 40],
]

function rollDroppedQualityTier(qualityBonusMultiplier = 1): string {
  for (const [tier, chance] of QUALITY_DROP_CHANCES) {
    if (Math.random() < chance * qualityBonusMultiplier) return tier
  }
  return 'normal'
}

const COMPOSITION_PLUS_ONE_DROP_CHANCE = QUALITY_DROP_CHANCES.find(([tier]) => tier === 'infused')![1]

function rollDroppedCompositionLevel(qualityBonusMultiplier = 1): number {
  return Math.random() < COMPOSITION_PLUS_ONE_DROP_CHANCE * qualityBonusMultiplier ? 1 : 0
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

const MONSTER_DEFENSE_MULTIPLIER_BY_COLOR: Record<LevelDiffColor, number> = {
  green: 0.5,
  white: 0.75,
  red: 1,
  black: 1,
}

interface EnemyType {
  id: string
  level: number
  max_hp: number
  gold_reward: number
  zone_id: string | null
}

function rollIsRare(): boolean {
  return Math.random() < RARE_CHANCE
}

function spawnMonsterHp(type: EnemyType, isRare: boolean): number {
  return isRare ? Math.round(type.max_hp * RARE_HP_MULTIPLIER) : type.max_hp
}

function monsterDefense(type: EnemyType, characterLevel: number): number {
  const base = Math.round(type.level * 1.5)
  return Math.round(base * MONSTER_DEFENSE_MULTIPLIER_BY_COLOR[getLevelDiffColor(characterLevel, type.level)])
}

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

// Min/max damage roll — mirrors combatResolver.ts's damageRangeFromMidpoint/
// rollDamageInRange (must stay in sync). Not needed by single-target's own
// resolve-combat (deterministic expected-value math there), but Multi-Shot
// (2026-08-17, requested by the user) is a discrete, single, player-pressed
// action rather than a continuous per-tick accrual — closer to World Boss's
// "one real, immediately server-resolved attempt" than to single-target's
// continuous formula — so real rolled damage (with visible variance, and a
// real number to show as a floating "-N") makes more sense here than an
// expected-value fraction, without reintroducing the client/server
// divergence problem the EV rewrite fixed (that was about the SAME window
// being simulated twice; here the server rolls once, the client only ever
// displays what the server already decided).
const DAMAGE_ROLL_MIN_RATIO = 0.9
const DAMAGE_ROLL_MAX_RATIO = 1.1

function rollDamageInRange(midpoint: number): number {
  const min = Math.max(1, Math.round(midpoint * DAMAGE_ROLL_MIN_RATIO))
  const max = Math.max(min, Math.round(midpoint * DAMAGE_ROLL_MAX_RATIO))
  return min + Math.floor(Math.random() * (max - min + 1))
}

// Multi-Shot deals reduced damage per target since it hits every alive slot
// at once (2026-08-17, requested by the user, "50% of the damage
// calculation") — applied to the final resolved (post-defense) damage
// number, not the raw attack value, so it reads as a flat "half of what a
// normal hit would have dealt" rather than interacting with the
// MIN_DAMAGE_PERCENT_OF_ATTACK floor in a less obvious way.
const MULTI_SHOT_DAMAGE_MULTIPLIER = 0.5

function rollBonusCurrencyDrops(cometMultiplier: number, fallenStarMultiplier: number) {
  return {
    comets: Math.random() < COMET_DROP_CHANCE * cometMultiplier ? 1 : 0,
    fallenStars: Math.random() < FALLEN_STAR_DROP_CHANCE * fallenStarMultiplier ? 1 : 0,
  }
}

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

const PROMOTION_TIER_ANCHORS = [1, 15, 40, 70, 100, 110, 120]
const KILLS_PER_LEVEL_BY_TIER = [200, 350, 650, 1300, 2600, 5200, 10000]

function killsPerLevelForLevel(level: number): number {
  let tierIndex = 0
  for (let i = 0; i < PROMOTION_TIER_ANCHORS.length; i += 1) {
    if (level >= PROMOTION_TIER_ANCHORS[i]) tierIndex = i
  }
  return KILLS_PER_LEVEL_BY_TIER[tierIndex]
}

function expRewardForLevel(level: number): number {
  return Math.max(1, Math.round(requiredExpForLevel(level) / killsPerLevelForLevel(level)))
}

const DAMAGE_EXP_SHARE = 0.5
const INVENTORY_SLOT_CAP = 40

// ---------------------------------------------------------------------------
// Row-combat-specific constants.
// ---------------------------------------------------------------------------
// Hard AFK cutoff — NOT the multi-hour bounded cap single-target combat uses
// for real catch-up. Row combat has no catch-up concept at all: any gap past
// ordinary live-tick jitter (the 4s reconcile cadence plus network slack) is
// defined as zero elapsed time, by design. See the file header.
const ROW_LIVE_LIVENESS_THRESHOLD_MS = 10_000
// Aligned with MULTI_SHOT_COOLDOWN_MS (2026-08-17, requested by the user) —
// both 10s, so a slot that died right as Multi-Shot went on cooldown is
// back up by the time it's off cooldown again. Mirrored in
// useRowCombatStore.ts's own ROW_RESPAWN_MS, must stay in sync.
const ROW_RESPAWN_MS = 10_000
// Placeholder/tunable, matches the plan's confirmed default.
const MULTI_SHOT_COOLDOWN_MS = 10_000

interface RowSlot {
  enabled: boolean
  monsterId: string | null
  currentHp: number
  maxHp: number
  isRare: boolean
  deadAt: number | null
}

function parseRowSlots(raw: unknown): RowSlot[] {
  const arr = Array.isArray(raw) ? raw : []
  const slots: RowSlot[] = []
  for (let i = 0; i < 12; i += 1) {
    const s = arr[i] as Record<string, unknown> | undefined
    slots.push({
      enabled: Boolean(s?.enabled),
      monsterId: (s?.monster_id as string | null) ?? null,
      currentHp: typeof s?.current_hp === 'number' ? s.current_hp : 0,
      maxHp: typeof s?.max_hp === 'number' ? s.max_hp : 0,
      isRare: Boolean(s?.is_rare),
      deadAt: typeof s?.dead_at === 'string' ? new Date(s.dead_at as string).getTime() : null,
    })
  }
  return slots
}

function serializeRowSlots(slots: RowSlot[]): unknown[] {
  return slots.map((s) => ({
    enabled: s.enabled,
    monster_id: s.monsterId,
    current_hp: s.currentHp,
    max_hp: s.maxHp,
    is_rare: s.isRare,
    dead_at: s.deadAt !== null ? new Date(s.deadAt).toISOString() : null,
  }))
}

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
  try {
    return await handleResolveRowCombat(req)
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    console.error('resolve-row-combat unhandled exception:', detail)
    return json({ ok: false, error: 'unhandled_exception', detail }, 500)
  }
})

interface CharacterSnapshot {
  id: string
  account_id: string
  class: string | null
  level: number
  gold: number
  exp: number
  comet_count: number
  fallen_star_count: number
  equipped_weapon_id: string | null
  equipped_ring_id: string | null
  equipped_necklace_id: string | null
  equipped_boots_id: string | null
  equipped_hat_id: string | null
  equipped_coat_id: string | null
  equipped_quiver_id: string | null
  row_combat_last_resolved_at: string
  row_multi_shot_last_fired_at: string
}

interface EquippedItemRow {
  id: string
  quality_tier: string
  base_stats: Record<string, number>
  slot_type: string
  composition_level: number
  durability: number | null
  sockets: (string | null)[]
}

interface GatherStateResult {
  ok: boolean
  error?: string
  claimed?: boolean
  claimed_at?: string | null
  restore_at?: string | null
  character?: CharacterSnapshot
  row_slots?: unknown[]
  enemy_types?: Record<string, EnemyType>
  equipped_items?: EquippedItemRow[]
  gear_count?: number
  potion_count?: number
  character_kills?: Record<string, { kills: number | string; claimed_tier_index: number }>
  pet_monster_ids?: string[]
  player?: {
    account_zone_attack_bonus_pct: Record<string, number> | null
    account_zone_drop_bonus_pct: Record<string, number> | null
  } | null
  // Gold Donation Event's active buff, if any (see CLAUDE.server-events.md)
  // — mirrors resolve-combat's own field, was missing here entirely until
  // 2026-08-17 (reported by the user), so Multi-Shot kills never benefited
  // from a live event buff the way single-target kills already did.
  active_event?: { category: string; multiplier: number } | null
}

async function handleResolveRowCombat(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ ok: false, error: 'not_authenticated' }, 401)
  }

  let characterId: string | undefined
  let fireMultiShot = false
  try {
    const body = await req.json()
    characterId = body.characterId
    fireMultiShot = Boolean(body.fireMultiShot)
  } catch {
    // fall through to the missing-characterId check below
  }

  if (!characterId) {
    return json({ ok: false, error: 'missing_character_id' }, 400)
  }

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

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: gatherData, error: gatherError } = await db.rpc('resolve_row_combat_gather_state', {
    p_character_id: characterId,
  })

  if (gatherError || !gatherData) {
    console.error('resolve-row-combat gather failed:', gatherError?.message)
    return json({ ok: false, error: 'query_failed', detail: gatherError?.message }, 500)
  }

  const gathered = gatherData as GatherStateResult

  if (!gathered.ok) {
    if (gathered.error === 'not_found') return json({ ok: false, error: 'not_owner' }, 403)
    console.error('resolve-row-combat gather returned an error:', gathered.error)
    return json({ ok: false, error: gathered.error ?? 'query_failed' }, 500)
  }

  const resolvedCharacterId: string = characterId
  // Best-effort compensating rollback, same shape/reasoning as
  // resolve-combat's own — a thrown error anywhere below releases the claim
  // so the next resolve call recovers the real elapsed window instead of it
  // silently vanishing (bounded to ~10s here regardless, per
  // ROW_LIVE_LIVENESS_THRESHOLD_MS, but still worth getting right).
  const claimedAt = gathered.claimed_at ?? null
  const restoreAt = gathered.restore_at ?? null
  async function releaseClaim(reason: string) {
    if (!claimedAt || !restoreAt) return
    try {
      const { data: released, error: releaseError } = await db.rpc('resolve_row_combat_release_claim', {
        p_character_id: resolvedCharacterId,
        p_claimed_at: claimedAt,
        p_restore_to: restoreAt,
      })
      if (releaseError) {
        console.error(`resolve-row-combat release_claim failed after ${reason}:`, releaseError.message)
      } else if (!released) {
        console.error(`resolve-row-combat release_claim no-op (already re-claimed) after ${reason}`)
      }
    } catch (err) {
      console.error(`resolve-row-combat release_claim threw after ${reason}:`, err instanceof Error ? err.message : String(err))
    }
  }

  const character = gathered.character
  if (!character) {
    await releaseClaim('missing character after gather')
    return json({ ok: false, error: 'query_failed' }, 500)
  }

  if (character.account_id !== user.id) {
    await releaseClaim('ownership mismatch')
    return json({ ok: false, error: 'not_owner' }, 403)
  }

  if (!gathered.claimed) {
    return json({
      ok: true,
      elapsedMs: 0,
      gained: { kills: 0, rareKills: 0, gold: 0, exp: 0 },
      character: { gold: character.gold, exp: character.exp, level: character.level, comets: character.comet_count, fallenStars: character.fallen_star_count },
      leveledUp: false,
      itemsGranted: [],
      inventoryFull: false,
      rowSlots: serializeRowSlots(parseRowSlots(gathered.row_slots)),
      multiShotFired: false,
      multiShotOnCooldown: false,
      multiShotNoTarget: false,
      multiShotHits: [],
      petObtained: null,
    })
  }

  // Everything below spends the claim resolve_row_combat_gather_state already
  // committed — wrapped so any failure releases that claim instead of
  // silently eating the window (see releaseClaim above).
  try {

  const now = Date.now()
  const lastResolvedMs = new Date(character.row_combat_last_resolved_at).getTime()
  // Hard cutoff, not a catch-up cap — see ROW_LIVE_LIVENESS_THRESHOLD_MS's
  // own comment. Anything past this is zeroed, not simulated.
  const elapsedMs = now - lastResolvedMs > ROW_LIVE_LIVENESS_THRESHOLD_MS ? 0 : Math.max(0, now - lastResolvedMs)

  const enemyTypesById = gathered.enemy_types ?? {}
  const slots = parseRowSlots(gathered.row_slots)
  const hasAnyEnabledSlot = slots.some((s) => s.enabled)

  const attributes = getAttributesForLevel(character.class ?? 'hunter', character.level)
  const equipmentBonus = { physicalAttack: 0, magicAttack: 0, dexterity: 0 }
  let compositionPhysicalAttackBonus = 0
  let compositionMagicAttackBonus = 0
  let drakeBonusPct = 0
  let emberBonusPct = 0
  let irisBonusPct = 0

  for (const item of gathered.equipped_items ?? []) {
    if ((item.durability ?? 0) <= 0) continue
    equipmentBonus.physicalAttack += scaledStat(item.base_stats, 'physical_attack', item.quality_tier) ?? 0
    equipmentBonus.magicAttack += scaledStat(item.base_stats, 'magic_attack', item.quality_tier) ?? 0
    equipmentBonus.dexterity += scaledStat(item.base_stats, 'dexterity', item.quality_tier) ?? 0
    compositionPhysicalAttackBonus += compositionBonusStat(item.base_stats, 'physical_attack', item.slot_type, item.composition_level)
    compositionMagicAttackBonus += compositionBonusStat(item.base_stats, 'magic_attack', item.slot_type, item.composition_level)
    drakeBonusPct += sumSocketedGemBonusPct(item.sockets, 'drake')
    emberBonusPct += sumSocketedGemBonusPct(item.sockets, 'ember')
    irisBonusPct += sumSocketedGemBonusPct(item.sockets, 'iris')
  }

  const derived = computeDerivedStats(attributes, equipmentBonus)
  const isHunter = character.class === 'hunter'

  // Gold Donation Event's active buff (2026-08-17, requested by the user —
  // was missing entirely before this) — mirrors resolve-combat/index.ts's
  // own derivation exactly. Exactly one of these is > 1 at a time, matching
  // whichever category the event rolled ('socket_unlock' is handled in the
  // Forge RPCs, never applies here).
  const activeEvent = gathered.active_event ?? null
  const eventExpMultiplier = activeEvent?.category === 'exp' ? activeEvent.multiplier : 1
  const eventCometMultiplier = activeEvent?.category === 'comet' ? activeEvent.multiplier : 1
  const eventFallenStarMultiplier = activeEvent?.category === 'fallen_star' ? activeEvent.multiplier : 1
  const eventQualityMultiplier = activeEvent?.category === 'quality_tier' ? activeEvent.multiplier : 1

  // Per-zone attack midpoint — zone-scoped bonuses (account_zone_attack_bonus_pct)
  // mean the player's effective attack power can differ per slot's own
  // monster's zone, since each slot locks in whatever was selected at its own
  // toggle-on time. Memoized since there are only ever a handful of distinct
  // zones across 12 slots.
  const attackMidpointByZone = new Map<string, number>()
  function attackMidpointForZone(zoneId: string | null): number {
    const key = zoneId ?? ''
    const cached = attackMidpointByZone.get(key)
    if (cached !== undefined) return cached
    const accountAttackBonusPct = gathered.player?.account_zone_attack_bonus_pct?.[key] ?? 0
    const physicalSubtotal = derived.physicalAttack * (1 + accountAttackBonusPct / 100) + compositionPhysicalAttackBonus
    const magicSubtotal = derived.magicAttack * (1 + accountAttackBonusPct / 100) + compositionMagicAttackBonus
    const value = physicalSubtotal * (1 + drakeBonusPct / 100) + magicSubtotal * (1 + emberBonusPct / 100)
    attackMidpointByZone.set(key, value)
    return value
  }

  function accountDropMultiplierForZone(zoneId: string | null): number {
    const zoneDropBonusPct = gathered.player?.account_zone_drop_bonus_pct?.[zoneId ?? ''] ?? 0
    return 1 + zoneDropBonusPct / 100
  }

  // Room-check baseline — mirrors resolve-combat's occupied/projectedOccupied
  // tracking (gear + potions + already-owned comet/fallen-star counts).
  // Composition stones aren't read here (row combat doesn't touch them) —
  // a small, accepted under-count relative to resolve-combat's own baseline,
  // since stones can't be gained through this path anyway.
  let occupied = (gathered.gear_count ?? 0) + (gathered.potion_count ?? 0) + character.comet_count + character.fallen_star_count
  let inventoryFull = false

  const petAlreadyUnlocked = new Set(gathered.pet_monster_ids ?? [])
  let petObtainedMonsterId: string | null = null
  let rareKills = 0
  let goldGainedFloat = 0
  let rawExpGainedFloat = 0
  const killDeltas: Record<string, number> = {}
  const droppedTemplates: { id: string; required_level: number; slot_type: string; qualityTier: string; compositionLevel: number }[] = []
  let cometsGained = 0
  let fallenStarsGained = 0
  // Per-target Multi-Shot results (real rolled hit/miss/damage), relayed to
  // the client so it can render floating damage numbers on each row slot —
  // see the file header note on why Multi-Shot uses real rolls instead of
  // the deterministic expected-value math single-target combat uses.
  const multiShotHits: { slotIndex: number; hit: boolean; damage: number }[] = []

  let jadeShardTemplate: { id: string; required_level: number; slot_type: string } | null | undefined
  async function pickJadeShardTemplate() {
    if (jadeShardTemplate !== undefined) return jadeShardTemplate
    const { data, error } = await db.from('item_templates').select('id, required_level, slot_type').eq('name', 'Jade Shard').maybeSingle()
    if (error) {
      console.error('resolve-row-combat Jade Shard template lookup failed:', error.message)
      jadeShardTemplate = null
    } else {
      jadeShardTemplate = (data as { id: string; required_level: number; slot_type: string } | null) ?? null
    }
    return jadeShardTemplate
  }

  function processRespawnsUpTo(untilMs: number) {
    for (const slot of slots) {
      if (slot.enabled && slot.deadAt !== null && untilMs - slot.deadAt >= ROW_RESPAWN_MS) {
        const type = slot.monsterId ? enemyTypesById[slot.monsterId] : undefined
        if (!type) continue
        const isRare = rollIsRare()
        const hp = spawnMonsterHp(type, isRare)
        slot.currentHp = hp
        slot.maxHp = hp
        slot.isRare = isRare
        slot.deadAt = null
      }
    }
  }

  // Applies one real, rolled hit to a single slot (Multi-Shot's own damage
  // model — see the rollDamageInRange comment above for why this is a real
  // roll rather than single-target's deterministic expected-value math),
  // mutating its current_hp directly. A kill is simply current_hp crossing
  // <= 0; overkill is naturally discarded, and damage-dealt EXP accrues on
  // every landed hit regardless of whether it kills, matching the intent of
  // resolve-combat's own DAMAGE_EXP_SHARE mechanic. Records the outcome
  // (hit/miss/damage) in multiShotHits either way, so the client can show a
  // real floating number/Miss text per target instead of nothing.
  async function applyHitToSlot(slotIndex: number, eventTimeMs: number) {
    if (inventoryFull) return
    const slot = slots[slotIndex]
    if (!slot.enabled || !slot.monsterId || slot.currentHp <= 0) return
    const type = enemyTypesById[slot.monsterId]
    if (!type) return

    const hitChance = 1 - Math.min(Math.max(0, monsterDodge(type) - derived.dexterity) * DODGE_CHANCE_PER_POINT, MAX_DODGE_CHANCE)

    if (Math.random() >= hitChance) {
      multiShotHits.push({ slotIndex, hit: false, damage: 0 })
      return
    }

    const rawDamage = resolvePhysicalDamage(rollDamageInRange(attackMidpointForZone(type.zone_id)), monsterDefense(type, character.level))
    const damage = Math.max(1, Math.round(rawDamage * MULTI_SHOT_DAMAGE_MULTIPLIER))
    const expMultiplier = EXP_MULTIPLIER_BY_COLOR[getLevelDiffColor(character.level, type.level)]

    rawExpGainedFloat += damage * ((expRewardForLevel(type.level) * DAMAGE_EXP_SHARE) / type.max_hp) * expMultiplier * RARE_BLENDED_DAMAGE_EXP_FACTOR
    slot.currentHp -= damage
    multiShotHits.push({ slotIndex, hit: true, damage })

    if (slot.currentHp > 0) return

    // Real kill.
    slot.currentHp = 0
    slot.deadAt = eventTimeMs
    if (rollIsRare()) rareKills += 1 // cosmetic flavor only, same as resolve-combat's own per-kill roll
    goldGainedFloat += type.gold_reward * RARE_BLENDED_REWARD_FACTOR
    rawExpGainedFloat += expRewardForLevel(type.level) * expMultiplier * RARE_BLENDED_REWARD_FACTOR
    killDeltas[type.id] = (killDeltas[type.id] ?? 0) + 1

    if (!petAlreadyUnlocked.has(type.id) && !petObtainedMonsterId && Math.random() < PET_DROP_CHANCE) {
      petObtainedMonsterId = type.id
    }

    const accountDropMultiplier = accountDropMultiplierForZone(type.zone_id)

    if (Math.random() < DROP_CHANCE) {
      const { data: dropped } = await db.rpc('pick_drop_template', { p_level: type.level })
      const template = dropped as { id: string; required_level: number; slot_type: string } | null
      if (template) {
        if (occupied < INVENTORY_SLOT_CAP) {
          droppedTemplates.push({
            ...template,
            qualityTier: rollDroppedQualityTier(accountDropMultiplier * eventQualityMultiplier),
            compositionLevel: rollDroppedCompositionLevel(accountDropMultiplier * eventQualityMultiplier),
          })
          occupied += 1
        } else {
          inventoryFull = true
        }
      }
    }

    if (!inventoryFull) {
      const bonusCurrency = rollBonusCurrencyDrops(
        accountDropMultiplier * eventCometMultiplier,
        accountDropMultiplier * eventFallenStarMultiplier,
      )
      if (bonusCurrency.comets > 0) {
        if (occupied < INVENTORY_SLOT_CAP) {
          cometsGained += 1
          occupied += 1
        } else {
          inventoryFull = true
        }
      }
      if (!inventoryFull && bonusCurrency.fallenStars > 0) {
        if (occupied < INVENTORY_SLOT_CAP) {
          fallenStarsGained += 1
          occupied += 1
        } else {
          inventoryFull = true
        }
      }
    }

    if (!inventoryFull && JADE_SHARD_MONSTER_IDS.includes(type.id) && Math.random() < JADE_SHARD_DROP_CHANCE) {
      const jadeShard = await pickJadeShardTemplate()
      if (jadeShard) {
        if (occupied < INVENTORY_SLOT_CAP) {
          droppedTemplates.push({ ...jadeShard, qualityTier: 'normal', compositionLevel: 0 })
          occupied += 1
        } else {
          inventoryFull = true
        }
      }
    }
  }

  // No basic auto-attack against row slots (2026-08-17, requested by the
  // user — with 6 slots to auto-target across, plain auto-attack alone was
  // clearing Row 1 fast enough that Multi-Shot barely mattered). Row slots
  // are ability/passive-only targets now — the only thing that happens on
  // a plain resolve call (no fireMultiShot) is processing any respawns
  // that came due, below.
  processRespawnsUpTo(now)

  let multiShotFired = false
  let multiShotOnCooldown = false
  // No living target to hit (2026-08-17, requested by the user) — pressing
  // Multi-Shot with every enabled slot empty/dead is a no-op that does NOT
  // consume the cooldown, same spirit as the on-cooldown case above not
  // consuming it either. Checked AFTER processRespawnsUpTo so a slot whose
  // 10s respawn timer just elapsed counts as a valid target.
  let multiShotNoTarget = false
  const multiShotLastFiredMs = new Date(character.row_multi_shot_last_fired_at).getTime()
  let newMultiShotLastFiredAt = character.row_multi_shot_last_fired_at

  if (fireMultiShot && isHunter && hasAnyEnabledSlot) {
    if (now - multiShotLastFiredMs < MULTI_SHOT_COOLDOWN_MS) {
      multiShotOnCooldown = true
    } else {
      processRespawnsUpTo(now)
      const aliveTargets = slots.map((s, i) => i).filter((i) => slots[i].enabled && slots[i].currentHp > 0)
      if (aliveTargets.length === 0) {
        multiShotNoTarget = true
      } else if (!inventoryFull) {
        for (const idx of aliveTargets) {
          if (inventoryFull) break
          await applyHitToSlot(idx, now)
        }
        multiShotFired = true
        newMultiShotLastFiredAt = new Date(now).toISOString()
      }
    }
  }

  processRespawnsUpTo(now)

  const goldGained = Math.round(goldGainedFloat)
  const expGained = Math.round(rawExpGainedFloat * (1 + irisBonusPct / 100) * eventExpMultiplier)
  const totalKills = Object.values(killDeltas).reduce((sum, v) => sum + v, 0)

  let level = character.level
  let exp = character.exp
  if (level < MAX_CHARACTER_LEVEL) exp += expGained
  while (level < MAX_CHARACTER_LEVEL && exp >= requiredExpForLevel(level)) {
    exp -= requiredExpForLevel(level)
    level += 1
  }

  const itemDropsPayload = droppedTemplates.map((t) => ({
    template_id: t.id,
    required_level: t.required_level,
    quality_tier: t.qualityTier,
    composition_level: t.compositionLevel,
    max_durability: 0,
  }))

  const killDeltasPayload = Object.entries(killDeltas).map(([monsterId, kills]) => ({ monster_id: monsterId, kills }))

  const { data: applyData, error: applyError } = await db.rpc('resolve_row_combat_apply_results', {
    p_character_id: resolvedCharacterId,
    p_account_id: character.account_id,
    p_kill_deltas: killDeltasPayload,
    p_gold_delta: goldGained,
    p_exp: exp,
    p_level: level,
    p_comet_delta: cometsGained,
    p_fallen_star_delta: fallenStarsGained,
    p_pet_obtained_monster_id: petObtainedMonsterId,
    p_item_drops: itemDropsPayload,
    p_row_slots: serializeRowSlots(slots),
    p_row_multi_shot_last_fired_at: newMultiShotLastFiredAt,
  })

  if (applyError || !applyData) {
    throw new Error(`resolve_row_combat_apply_results failed: ${applyError?.message ?? 'no data returned'}`)
  }

  const apply = applyData as {
    gold?: number
    comet_count?: number
    fallen_star_count?: number
    granted_items?: unknown[]
    row_slots?: unknown[]
    kill_count_updates?: { monster_id: string; character_kills: number | string; account_kills: number | string }[]
  }

  return json({
    ok: true,
    elapsedMs,
    gained: { kills: totalKills, rareKills, gold: goldGained, exp: expGained },
    character: {
      gold: apply.gold ?? character.gold + goldGained,
      exp,
      level,
      comets: apply.comet_count ?? character.comet_count + cometsGained,
      fallenStars: apply.fallen_star_count ?? character.fallen_star_count + fallenStarsGained,
    },
    leveledUp: level > character.level,
    itemsGranted: apply.granted_items ?? [],
    inventoryFull,
    rowSlots: apply.row_slots ?? serializeRowSlots(slots),
    multiShotFired,
    multiShotOnCooldown,
    multiShotNoTarget,
    multiShotReadyAt: new Date(new Date(newMultiShotLastFiredAt).getTime() + MULTI_SHOT_COOLDOWN_MS).toISOString(),
    multiShotHits,
    petObtained: petObtainedMonsterId,
    killCountUpdates: apply.kill_count_updates ?? [],
  })
  } catch (err) {
    await releaseClaim('unhandled error during reward resolution')
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    console.error('resolve-row-combat reward resolution failed:', detail)
    return json({ ok: false, error: 'resolve_failed', detail }, 500)
  }
}
