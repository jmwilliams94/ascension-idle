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
// Mirrors src/game/stats/classes.ts's CLASS_DEFINITIONS[...].baseAttributes —
// attributes are a pure function of class (no per-character point allocation
// exists yet), so the server can derive them straight from characters.class.
// ---------------------------------------------------------------------------
interface Attributes {
  strength: number
  agility: number
  vitality: number
  spirit: number
}

const BASE_ATTRIBUTES_BY_CLASS: Record<string, Attributes> = {
  juggernaut: { strength: 5, agility: 2, vitality: 3, spirit: 0 },
  'twin-soul': { strength: 5, agility: 2, vitality: 3, spirit: 0 },
  wuxia: { strength: 0, agility: 2, vitality: 3, spirit: 5 },
  hunter: { strength: 3, agility: 5, vitality: 2, spirit: 0 },
}

// Mirrors src/game/stats/derivedStats.ts
const BASE_HP = 50
const PHYSICAL_ATTACK_PER_STRENGTH = 2
const MAGIC_ATTACK_PER_SPIRIT = 2
const BASE_ATTACK_SPEED = 1.0

function computeDerivedStats(attributes: Attributes, equipmentBonus: { physicalAttack?: number; magicAttack?: number }) {
  const hp = BASE_HP + attributes.vitality * 24 + attributes.strength * 3 + attributes.agility * 3 + attributes.spirit * 3
  const physicalAttack = attributes.strength * PHYSICAL_ATTACK_PER_STRENGTH + (equipmentBonus.physicalAttack ?? 0)
  const magicAttack = attributes.spirit * MAGIC_ATTACK_PER_SPIRIT + (equipmentBonus.magicAttack ?? 0)
  return { hp, physicalAttack, magicAttack, attackSpeed: BASE_ATTACK_SPEED }
}

// Mirrors src/game/items/equipmentBonus.ts
const QUALITY_STAT_MULTIPLIERS: Record<string, number> = {
  normal: 1,
  refined: 1.1,
  unique: 1.2,
  elite: 1.35,
  super: 1.5,
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
const DROP_CHANCE = 0.1

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

function rollBonusCurrencyDrops() {
  return {
    meteors: Math.random() < METEOR_DROP_CHANCE ? 1 : 0,
    dragonballs: Math.random() < DRAGONBALL_DROP_CHANCE ? 1 : 0,
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
  try {
    const body = await req.json()
    characterId = body.characterId
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
      'id, account_id, class, level, gold, exp, meteors, dragonballs, equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id, equipped_hat_id, equipped_coat_id, equipped_quiver_id, selected_monster_id, combat_last_resolved_at',
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
      character: { gold: character.gold, exp: character.exp, level: character.level, meteors: character.meteors, dragonballs: character.dragonballs },
      itemsGranted: [],
      itemsHeld: [],
    })
  }

  const { data: monster } = await db.from('enemy_types').select('*').eq('id', character.selected_monster_id).maybeSingle()

  if (!monster) {
    await db.from('characters').update({ combat_last_resolved_at: new Date(now).toISOString() }).eq('id', characterId)
    return json({ ok: false, error: 'unknown_monster' })
  }

  // Character combat stats — derived server-side, never trusted from the
  // request. Attributes are a pure function of class (see classes.ts); gear
  // bonus sums physical_attack/magic_attack across every equipped slot (Ring/
  // Necklace/Boots/Hat/Coat are now functional too, not just Main Hand — see
  // useEquipmentStore.ts/computeEquipmentBonus's client-side mirror). Only
  // physicalAttack/magicAttack matter here — physicalDefense/dodge feed
  // incoming-damage mitigation, which isn't simulated server-side (player
  // HP/knockout only ever lived in useCombatStore.runTick).
  const attributes = BASE_ATTRIBUTES_BY_CLASS[character.class ?? 'hunter'] ?? BASE_ATTRIBUTES_BY_CLASS.hunter
  const equipmentBonus: { physicalAttack: number; magicAttack: number } = { physicalAttack: 0, magicAttack: 0 }

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
  const droppedTemplates: { id: string; required_level: number }[] = []

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
      // Rolled independently per attack (see rollDamageInRange) rather than
      // a single precomputed value reused every iteration, so the offline/
      // idle simulation matches live combat's per-hit variance exactly
      // instead of falling back to an expected-value approximation.
      const damage = resolvePhysicalDamage(rollDamageInRange(attackMidpoint), monsterDefense(monster))
      hp -= damage

      if (hp <= 0) {
        kills += 1
        if (isRare) rareKills += 1

        const rewards = killRewards(monster, isRare, character.level)
        goldGained += rewards.gold
        expGained += rewards.exp

        if (Math.random() < DROP_CHANCE) {
          const dropped = pickDropTemplate()
          if (dropped) droppedTemplates.push(dropped)
        }

        const bonusCurrency = rollBonusCurrencyDrops()
        meteorsGained += bonusCurrency.meteors
        dragonballsGained += bonusCurrency.dragonballs

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

  // Inventory-full handling: grant into item_instances while there's room,
  // otherwise into loot_holding (confirmed with the user) up to its own cap —
  // beyond that, further drops in this window are genuinely lost, matching
  // the accepted extreme-edge-case behavior described in the plan.
  const [{ count: gearCount }, { data: composition }, { count: holdingCount }] = await Promise.all([
    db.from('item_instances').select('id', { count: 'exact', head: true }).eq('owner_id', characterId),
    db.from('characters').select('composition_stones').eq('id', characterId).maybeSingle(),
    db.from('loot_holding').select('id', { count: 'exact', head: true }).eq('character_id', characterId),
  ])

  const stoneSlotCount = Object.values((composition?.composition_stones as Record<string, number>) ?? {}).reduce(
    (sum, v) => sum + (typeof v === 'number' ? v : 0),
    0,
  )
  let occupied = (gearCount ?? 0) + stoneSlotCount
  let heldCount = holdingCount ?? 0

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

  for (const template of droppedTemplates) {
    if (occupied < INVENTORY_SLOT_CAP) {
      // level starts at the template's own required_level (not the schema
      // default of 1) so a freshly-granted item's displayed level honestly
      // reflects which tier it actually is.
      const { data: inserted } = await db
        .from('item_instances')
        .insert({ template_id: template.id, owner_id: characterId, level: template.required_level })
        .select('*')
        .single()
      occupied += 1
      if (inserted) itemsGranted.push(inserted)
    } else if (heldCount < LOOT_HOLDING_CAP) {
      await db.from('loot_holding').insert({ character_id: characterId, template_id: template.id })
      heldCount += 1
      itemsHeld.push({ template_id: template.id })
    }
    // else: genuinely lost, both Inventory and Loot Holding are full.
  }

  const newMeteors = character.meteors + meteorsGained
  const newDragonballs = character.dragonballs + dragonballsGained

  await db
    .from('characters')
    .update({
      gold: character.gold + goldGained,
      exp,
      level,
      meteors: newMeteors,
      dragonballs: newDragonballs,
      combat_last_resolved_at: new Date(now).toISOString(),
    })
    .eq('id', characterId)

  return json({
    ok: true,
    elapsedMs,
    // Deltas — for display/toast purposes only (combat-log flavor text).
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
  })
}
