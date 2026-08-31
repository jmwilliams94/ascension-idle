// PvP Duel action resolution — see CLAUDE.md's plan nifty-riding-journal for
// the full design writeup (Phase 1 of 4). Handles both duel actions a
// player can submit: `place_zone` (the defender secretly picks a 3x3 zone +
// their tile within it) and `guess` (the attacker picks one tile inside the
// visible zone). All turn/phase/ownership validation and the actual hidden-
// tile comparison happen in SQL (pvp_duel_gather_state/pvp_duel_apply_action,
// see 20261121000000_pvp_duel_core.sql) — this function's only job is to
// authenticate the caller and, when the action is a `guess`, precompute the
// damage that WOULD be dealt if it turns out to be a hit (the secret tile
// itself never reaches this function or any client — only the apply RPC,
// running fully inside Postgres, ever compares against it).
//
// KNOWN DUPLICATION, ACCEPTED (same relationship every other Edge Function
// in this project already has with the client): getAttributesForLevel/
// ATTRIBUTE_ANCHORS, scaledStat/QUALITY_STAT_MULTIPLIERS,
// compositionBonusStat, resolvePhysicalDamage, rollDamageInRange below are
// copied from resolve-combat/index.ts and world-boss-attack/index.ts, which
// are themselves deliberate, disclosed copies of
// src/game/stats/{derivedStats,classes}.ts and
// src/game/items/equipmentBonus.ts / src/game/combat/combatResolver.ts. If
// any of those change, mirror the change here too.
//
// Deliberately NOT applied here, per the confirmed PvP design (see the
// plan): magicAttack/magicDefense (no class skills participate — every
// class deals physical-formula damage only), dodge/dexterity hit-chance
// (the guessing game IS the accuracy layer — a landed guess always deals
// damage), Bastion/Bless damage reduction (not part of the confirmed
// design), account-wide zone attack bonus (PvP has no zone), and gear
// durability decay (a duel is a handful of discrete actions, not an
// elapsed-time window).
//
// PVP_DAMAGE_MULTIPLIER (0.5) is applied strictly after the shared PvE
// formula returns — confirmed by the user after a live self-mirror test
// (see plan) showed the raw PvE numbers ending duels in 2-3 hits.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// Explicitly set via `supabase secrets set SERVICE_ROLE_KEY=...`, same
// reasoning as resolve-combat/world-boss-attack.
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

const PVP_DAMAGE_MULTIPLIER = 0.5

// ---------------------------------------------------------------------------
// Mirrors src/game/stats/classes.ts
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

// Mirrors src/game/stats/derivedStats.ts — only the physicalAttack/
// physicalDefense fields PvP actually reads (see the file header for what's
// deliberately excluded).
const PHYSICAL_ATTACK_PER_STRENGTH = 2

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

const COMPOSITION_BONUS_PCT_PER_TIER = 0.1

const COMPOSITION_BONUS_STAT_KEYS: Record<string, string[]> = {
  weapon: ['physical_attack'],
  ring: ['physical_attack'],
  necklace: ['physical_defense'],
  hat: ['physical_defense'],
  coat: ['physical_defense'],
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

// Mirrors src/game/items/gemCatalog.ts — only Drake (Physical Attack) is
// read; Ember/Bastion/Iris have no role in PvP per the file header.
const DRAKE_PERCENT_BY_TIER: Record<string, number> = { normal: 5, tempered: 10, ascended: 15 }

function sumDrakeBonusPct(sockets: (string | null)[] | undefined): number {
  let total = 0
  for (const socket of sockets ?? []) {
    if (!socket) continue
    const match = /^drake_(normal|tempered|ascended)$/.exec(socket)
    if (!match) continue
    total += DRAKE_PERCENT_BY_TIER[match[1]] ?? 0
  }
  return total
}

const MIN_DAMAGE_PERCENT_OF_ATTACK = 0.1

function resolvePhysicalDamage(attack: number, defense: number): number {
  const mitigated = attack - defense
  const floor = Math.round(attack * MIN_DAMAGE_PERCENT_OF_ATTACK)
  return Math.max(mitigated, floor, 1)
}

// Mirrors src/game/combat/combatResolver.ts's damageRangeFromMidpoint/rollDamageInRange.
const DAMAGE_ROLL_MIN_RATIO = 0.9
const DAMAGE_ROLL_MAX_RATIO = 1.1

function rollDamageInRange(midpoint: number): number {
  const min = Math.max(1, Math.round(midpoint * DAMAGE_ROLL_MIN_RATIO))
  const max = Math.max(min, Math.round(midpoint * DAMAGE_ROLL_MAX_RATIO))
  return min + Math.floor(Math.random() * (max - min + 1))
}

interface CharacterSnapshot {
  id: string
  account_id: string
  class: string | null
  level: number
}

interface EquippedItemRow {
  quality_tier: string
  composition_level: number
  durability: number | null
  base_stats: Record<string, number>
  slot_type: string
  sockets: (string | null)[]
}

// Attacker's rolled physical attack — composition bonus folded in unscaled,
// then Drake's socketed gem % applied last, same ordering as
// useCombatStore.runTick/world-boss-attack.
function rollAttackerDamage(character: CharacterSnapshot, equippedItems: EquippedItemRow[]): number {
  const attributes = getAttributesForLevel(character.class ?? 'hunter', character.level)
  let physicalAttackFromGear = 0
  let compositionPhysicalAttackBonus = 0
  let drakeBonusPct = 0

  for (const item of equippedItems) {
    if ((item.durability ?? 0) <= 0) continue // broken gear contributes nothing, same rule as every other combat path
    physicalAttackFromGear += scaledStat(item.base_stats, 'physical_attack', item.quality_tier) ?? 0
    compositionPhysicalAttackBonus += compositionBonusStat(item.base_stats, 'physical_attack', item.slot_type, item.composition_level)
    drakeBonusPct += sumDrakeBonusPct(item.sockets)
  }

  const physicalAttack = attributes.strength * PHYSICAL_ATTACK_PER_STRENGTH + physicalAttackFromGear
  const physicalSubtotal = physicalAttack + compositionPhysicalAttackBonus
  const attackMidpoint = physicalSubtotal * (1 + drakeBonusPct / 100)
  return rollDamageInRange(attackMidpoint)
}

// Defender's physical defense — gear-only, no attribute contribution, same
// as src/game/stats/derivedStats.ts's `physicalDefense = equipmentBonus.physicalDefense ?? 0`.
function computeDefenderPhysicalDefense(equippedItems: EquippedItemRow[]): number {
  let physicalDefenseFromGear = 0
  let compositionPhysicalDefenseBonus = 0

  for (const item of equippedItems) {
    if ((item.durability ?? 0) <= 0) continue
    physicalDefenseFromGear += scaledStat(item.base_stats, 'physical_defense', item.quality_tier) ?? 0
    compositionPhysicalDefenseBonus += compositionBonusStat(item.base_stats, 'physical_defense', item.slot_type, item.composition_level)
  }

  return physicalDefenseFromGear + compositionPhysicalDefenseBonus
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
    return await handlePvpDuelAction(req)
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    console.error('resolve-pvp-duel unhandled exception:', detail)
    return json({ ok: false, error: 'unhandled_exception', detail }, 500)
  }
})

interface GatherStateResult {
  ok: boolean
  error?: string
  active?: boolean
  forfeited?: boolean
  duel?: Record<string, unknown>
  is_attacker?: boolean
  attacker_character?: CharacterSnapshot
  attacker_equipped_items?: EquippedItemRow[]
  defender_character?: CharacterSnapshot
  defender_equipped_items?: EquippedItemRow[]
}

async function handlePvpDuelAction(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ ok: false, error: 'not_authenticated' }, 401)
  }

  let duelId: string | undefined
  let characterId: string | undefined
  let turnNumber: number | undefined
  let action: { type?: string } | undefined
  try {
    const body = await req.json()
    duelId = body.duelId
    characterId = body.characterId
    turnNumber = body.turnNumber
    action = body.action
  } catch {
    // fall through to the missing-field check below
  }

  if (!duelId || !characterId || turnNumber === undefined || !action?.type) {
    return json({ ok: false, error: 'missing_fields' }, 400)
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
  // after the ownership check below — same trust model as resolve-combat/
  // world-boss-attack.
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: gatherData, error: gatherError } = await db.rpc('pvp_duel_gather_state', {
    p_duel_id: duelId,
    p_character_id: characterId,
  })

  if (gatherError || !gatherData) {
    console.error('resolve-pvp-duel gather failed:', gatherError?.message)
    return json({ ok: false, error: 'query_failed', detail: gatherError?.message }, 500)
  }

  const gathered = gatherData as GatherStateResult

  if (!gathered.ok) {
    const status = gathered.error === 'not_found' ? 404 : gathered.error === 'not_your_turn' ? 409 : 403
    return json(gathered, status)
  }

  // Duel already over (completed/forfeited) or the timeout check inside
  // gather just forfeited it — nothing further to do, just hand back the
  // current state.
  if (gathered.active === false) {
    return json(gathered)
  }

  const actingCharacter = gathered.is_attacker ? gathered.attacker_character : gathered.defender_character

  if (!actingCharacter || actingCharacter.account_id !== user.id) {
    return json({ ok: false, error: 'not_owner' }, 403)
  }

  let potentialDamage = 0
  if (action.type === 'guess') {
    // The secret tile itself never reaches this function — only the apply
    // RPC (running fully inside Postgres) compares against it. This is
    // purely "what damage WOULD this deal if the upcoming SQL comparison
    // says it's a hit" — discarded server-side on a miss.
    if (!gathered.attacker_character || !gathered.defender_character) {
      return json({ ok: false, error: 'missing_combat_snapshot' }, 500)
    }
    const rolledAttack = rollAttackerDamage(gathered.attacker_character, gathered.attacker_equipped_items ?? [])
    const defense = computeDefenderPhysicalDefense(gathered.defender_equipped_items ?? [])
    potentialDamage = Math.max(1, Math.round(resolvePhysicalDamage(rolledAttack, defense) * PVP_DAMAGE_MULTIPLIER))
  }

  const { data: applyData, error: applyError } = await db.rpc('pvp_duel_apply_action', {
    p_duel_id: duelId,
    p_character_id: characterId,
    p_turn_number: turnNumber,
    p_action: action,
    p_potential_damage: potentialDamage,
  })

  if (applyError || !applyData) {
    console.error('resolve-pvp-duel apply failed:', applyError?.message)
    return json({ ok: false, error: 'query_failed', detail: applyError?.message }, 500)
  }

  return json(applyData)
}
