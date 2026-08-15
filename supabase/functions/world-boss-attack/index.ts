// World Boss single-attack resolution — see CLAUDE.combat-and-loot.md and
// plan tranquil-knitting-acorn for the full design writeup.
//
// KNOWN DUPLICATION, ACCEPTED (same relationship resolve-combat/index.ts
// already has with the client): getAttributesForLevel/ATTRIBUTE_ANCHORS,
// computeDerivedStats, scaledStat/QUALITY_STAT_MULTIPLIERS,
// compositionBonusStat, resolvePhysicalDamage below are copied verbatim from
// resolve-combat/index.ts, which is itself a deliberate, disclosed copy of
// src/game/stats/{derivedStats,classes}.ts and src/game/items/equipmentBonus.ts.
// No supabase/functions/_shared/ folder exists in this project — every Edge
// Function is fully self-contained — so this is a second copy of the same
// already-duplicated math rather than a third, independent re-derivation.
// If any of resolve-combat's copies of this math change, mirror the change
// here too.
//
// Deliberately NOT copied from resolve-combat: the account-wide zone attack
// bonus (a boss has no zone) and gear durability decay (no natural elapsed-
// time window for one discrete click — a boss attempt is instantaneous, not
// a resolved time span).
//
// Deliberately no hit/dodge roll: a boss attempt is a guaranteed hit (one
// real damage roll, per the confirmed product spec) — a coin-flip miss on an
// AP-paid attempt would feel bad, and unlike live/offline combat, the reward
// here isn't smoothed over a whole window's worth of attacks.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// Explicitly set via `supabase secrets set SERVICE_ROLE_KEY=...`, same
// reasoning as resolve-combat/index.ts — the auto-injected
// SUPABASE_SERVICE_ROLE_KEY may not be the currently-active key on this
// project's newer publishable/secret API key system.
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

// ---------------------------------------------------------------------------
// Copied verbatim from resolve-combat/index.ts — see that file for the full
// sourcing writeup. Mirrors src/game/stats/classes.ts.
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
  const dexterity = attributes.agility * 1 + (equipmentBonus.dexterity ?? 0)
  return { hp, physicalAttack, magicAttack, attackSpeed: BASE_ATTACK_SPEED, dexterity }
}

// Mirrors src/game/items/equipmentBonus.ts
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

// Mirrors src/game/items/equipmentBonus.ts's computeCompositionBonusStats.
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

const MIN_DAMAGE_PERCENT_OF_ATTACK = 0.1

function resolvePhysicalDamage(attack: number, defense: number): number {
  const mitigated = attack - defense
  const floor = Math.round(attack * MIN_DAMAGE_PERCENT_OF_ATTACK)
  return Math.max(mitigated, floor, 1)
}

// PLACEHOLDER mitigation value, same disclosed-not-final status as every
// other economy number in this game (see the migration's max_hp comment) —
// picked to keep resolvePhysicalDamage's output sane across the level range,
// not a tuned balance figure.
const BOSS_DEFENSE = 500

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
    return await handleWorldBossAttack(req)
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    console.error('world-boss-attack unhandled exception:', detail)
    return json({ ok: false, error: 'unhandled_exception', detail }, 500)
  }
})

interface CharacterSnapshot {
  id: string
  account_id: string
  class: string | null
  level: number
  equipped_quiver_id: string | null
}

interface EquippedItemRow {
  id: string
  quality_tier: string
  template_id: string
  composition_level: number
  durability: number | null
  base_stats: Record<string, number>
  slot_type: string
  required_level: number
}

interface SpawnSnapshot {
  id: string
  status: string
  window_ends_at: string
}

interface GatherStateResult {
  ok: boolean
  error?: string
  character?: CharacterSnapshot
  equipped_items?: EquippedItemRow[]
  spawn?: SpawnSnapshot | null
}

async function handleWorldBossAttack(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ ok: false, error: 'not_authenticated' }, 401)
  }

  let characterId: string | undefined
  try {
    const body = await req.json()
    characterId = body.characterId
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

  // Privileged reads/writes only through this service-role client, only
  // after the ownership check below — same trust model as resolve-combat.
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: gatherData, error: gatherError } = await db.rpc('world_boss_gather_attack_state', {
    p_character_id: characterId,
  })

  if (gatherError || !gatherData) {
    console.error('world-boss-attack gather failed:', gatherError?.message)
    return json({ ok: false, error: 'query_failed', detail: gatherError?.message }, 500)
  }

  const gathered = gatherData as GatherStateResult

  if (!gathered.ok || !gathered.character) {
    if (gathered.error === 'not_found') {
      return json({ ok: false, error: 'not_owner' }, 403)
    }
    return json({ ok: false, error: gathered.error ?? 'query_failed' }, 500)
  }

  const character = gathered.character

  if (character.account_id !== user.id) {
    return json({ ok: false, error: 'not_owner' }, 403)
  }

  const spawn = gathered.spawn
  if (!spawn) {
    return json({ ok: false, error: 'no_active_spawn' }, 500)
  }

  // Combat stats — derived fresh from equipment+class+level, never trusted
  // from the request. See the file header for what's deliberately NOT
  // applied here (zone bonus, durability decay) versus resolve-combat.
  const attributes = getAttributesForLevel(character.class ?? 'hunter', character.level)
  const equipmentBonus: { physicalAttack: number; magicAttack: number; dexterity: number } = {
    physicalAttack: 0,
    magicAttack: 0,
    dexterity: 0,
  }
  let compositionAttackBonus = 0

  for (const item of gathered.equipped_items ?? []) {
    if ((item.durability ?? 0) <= 0) continue // broken item contributes nothing, same rule as resolve-combat

    equipmentBonus.physicalAttack += scaledStat(item.base_stats, 'physical_attack', item.quality_tier) ?? 0
    equipmentBonus.magicAttack += scaledStat(item.base_stats, 'magic_attack', item.quality_tier) ?? 0
    equipmentBonus.dexterity += scaledStat(item.base_stats, 'dexterity', item.quality_tier) ?? 0
    compositionAttackBonus += compositionBonusStat(item.base_stats, 'physical_attack', item.slot_type, item.composition_level)
    compositionAttackBonus += compositionBonusStat(item.base_stats, 'magic_attack', item.slot_type, item.composition_level)
  }

  const derived = computeDerivedStats(attributes, equipmentBonus)
  const attackMidpoint = derived.physicalAttack + derived.magicAttack + compositionAttackBonus

  // Hunter must have the Quiver equipped to attack at all — same gate live
  // combat enforces.
  if (character.class === 'hunter' && !character.equipped_quiver_id) {
    return json({ ok: false, error: 'quiver_required' })
  }

  const damage = resolvePhysicalDamage(attackMidpoint, BOSS_DEFENSE)

  const { data: applyData, error: applyError } = await db.rpc('apply_world_boss_attack', {
    p_character_id: characterId,
    p_spawn_id: spawn.id,
    p_damage: damage,
  })

  if (applyError || !applyData) {
    console.error('world-boss-attack apply failed:', applyError?.message)
    return json({ ok: false, error: 'query_failed', detail: applyError?.message }, 500)
  }

  // The apply RPC's response is the only thing the client will ever render
  // for "damage dealt" — no client-side prediction/tally, per the confirmed
  // product spec.
  return json(applyData)
}
