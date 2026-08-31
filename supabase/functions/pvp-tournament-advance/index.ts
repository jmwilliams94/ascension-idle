// PvP Tournament round seeding — see CLAUDE.md's plan nifty-riding-journal
// (Phase 3). Triggered two ways, both fire-and-forget from Postgres (never
// from a browser): pvp_tournament_kickoff_if_due (the Friday-noon-Brisbane
// pg_cron job, round 1) and pvp_tournament_maybe_advance (the instant every
// match in a round has resolved, round N+1) — see
// 20261127000000_pvp_tournament_core.sql/20261128000000_pvp_duel_tournament_hook.sql.
//
// Privileged-only, same shape as send-push/index.ts's X-Cron-Secret path:
// deployed with --no-verify-jwt (net.http_post from Postgres carries no
// user JWT, only the public apikey header Kong's routing needs), authorized
// instead by X-Cron-Secret matching the CRON_PUSH_SECRET env var (same
// shared Vault secret already provisioned for push notifications — see
// this function's own migration comment for why it's reused rather than a
// new one).
//
// Why this exists as an Edge Function at all rather than pure SQL like
// ensure_world_boss_spawn: every real tournament match starts both
// duelists at FULL, freshly-computed HP (not a continuation of previous
// damage) — that requires the same derivedStats/equipmentBonus TS mirror
// already duplicated into resolve-pvp-duel/index.ts, which SQL has no way
// to reach. KNOWN DUPLICATION, ACCEPTED, same as every other Edge Function
// here — see resolve-pvp-duel/index.ts's own header for the fuller
// writeup; this file only needs the HP half of that math (not
// attack/defense, which stays resolve-pvp-duel's job for actual duel
// turns).

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!
const CRON_PUSH_SECRET = Deno.env.get('CRON_PUSH_SECRET')

// ---------------------------------------------------------------------------
// Mirrors src/game/stats/classes.ts (same copy as resolve-pvp-duel/index.ts).
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

// Mirrors src/game/stats/derivedStats.ts's HP formula — the one piece of
// that math resolve-pvp-duel/index.ts doesn't need (a duel turn never
// recomputes max HP, only attack/defense), so it lives here instead.
const BASE_HP = 50

interface CharacterCombatSnapshot {
  character_id: string
  class: string | null
  level: number
  equipped_items: {
    quality_tier: string
    composition_level: number
    durability: number | null
    base_stats: Record<string, number>
    slot_type: string
    sockets: (string | null)[]
    enchant: { hp?: number } | null
  }[]
}

function computeMaxHp(snapshot: CharacterCombatSnapshot): number {
  const attributes = getAttributesForLevel(snapshot.class ?? 'hunter', snapshot.level)
  let enchantHpBonus = 0
  let gearHpBonus = 0

  for (const item of snapshot.equipped_items) {
    if ((item.durability ?? 0) <= 0) continue // broken gear contributes nothing, same rule as every other combat path
    enchantHpBonus += item.enchant?.hp ?? 0
    gearHpBonus += scaledStat(item.base_stats, 'max_hp', item.quality_tier) ?? 0
  }

  return (
    BASE_HP +
    attributes.vitality * 24 +
    attributes.strength * 3 +
    attributes.agility * 3 +
    attributes.spirit * 3 +
    enchantHpBonus +
    gearHpBonus
  )
}

interface Contestant {
  characterId: string
  characterName: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Fisher-Yates — round 1's pairing order should be random, not registration
// order (which would let two friends who registered back-to-back always
// duck each other in round 1 by registering apart, or always face each
// other by registering together).
function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

Deno.serve(async (req) => {
  try {
    return await handleAdvance(req)
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    console.error('pvp-tournament-advance unhandled exception:', detail)
    return json({ ok: false, error: 'unhandled_exception', detail }, 500)
  }
})

async function handleAdvance(req: Request): Promise<Response> {
  const cronSecretHeader = req.headers.get('X-Cron-Secret')
  if (!CRON_PUSH_SECRET || cronSecretHeader !== CRON_PUSH_SECRET) {
    return json({ ok: false, error: 'not_authorized' }, 403)
  }

  let tournamentId: string | undefined
  let round: number | undefined
  try {
    const body = await req.json()
    tournamentId = body.tournament_id
    round = body.round
  } catch {
    // fall through to the missing-field check below
  }

  if (!tournamentId || !round) {
    return json({ ok: false, error: 'missing_fields' }, 400)
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  let contestants: Contestant[]

  if (round === 1) {
    const { data, error } = await db
      .from('pvp_tournament_registrations')
      .select('character_id, character_name')
      .eq('tournament_id', tournamentId)

    if (error) {
      console.error('pvp-tournament-advance registrations query failed:', error.message)
      return json({ ok: false, error: 'query_failed', detail: error.message }, 500)
    }

    contestants = shuffle((data ?? []).map((row) => ({ characterId: row.character_id, characterName: row.character_name })))
  } else {
    const { data, error } = await db
      .from('pvp_tournament_matches')
      .select('winner_character_id, character_a_id, character_a_name, character_b_id, character_b_name')
      .eq('tournament_id', tournamentId)
      .eq('round', round - 1)

    if (error) {
      console.error('pvp-tournament-advance previous-round query failed:', error.message)
      return json({ ok: false, error: 'query_failed', detail: error.message }, 500)
    }

    contestants = (data ?? [])
      .filter((row) => row.winner_character_id)
      .map((row) => ({
        characterId: row.winner_character_id as string,
        characterName: row.winner_character_id === row.character_a_id ? row.character_a_name : row.character_b_name,
      }))
  }

  if (contestants.length === 0) {
    return json({ ok: false, error: 'no_contestants' }, 400)
  }

  if (contestants.length === 1) {
    // A single survivor with no one left to face — same "resolves
    // immediately, no duel" shape pvp_tournament_write_round already
    // handles for a bye; write a 1-slot bye round so the existing
    // maybe_advance finalization logic (triggered from write_round itself
    // when v_total = 1) picks it up uniformly.
    const { error } = await db.rpc('pvp_tournament_write_round', {
      p_tournament_id: tournamentId,
      p_round: round,
      p_pairings: [{ character_a_id: contestants[0].characterId, character_a_name: contestants[0].characterName }],
    })
    if (error) {
      console.error('pvp-tournament-advance single-survivor write failed:', error.message)
      return json({ ok: false, error: 'query_failed', detail: error.message }, 500)
    }
    return json({ ok: true, matches: 1 })
  }

  let bracketSize = 1
  while (bracketSize < contestants.length) bracketSize *= 2

  // HP only needs computing for contestants who actually have a real
  // opponent this round (a bye needs none) — batch-fetch just those.
  const realPairCount = Math.floor(contestants.length / 2) * 2
  const idsNeedingHp = contestants.slice(0, realPairCount).map((c) => c.characterId)

  const { data: combatData, error: combatError } = idsNeedingHp.length
    ? await db.rpc('pvp_tournament_gather_character_combat_data', { p_character_ids: idsNeedingHp })
    : { data: [] as CharacterCombatSnapshot[], error: null }

  if (combatError) {
    console.error('pvp-tournament-advance combat-data gather failed:', combatError.message)
    return json({ ok: false, error: 'query_failed', detail: combatError.message }, 500)
  }

  const hpByCharacterId = new Map<string, number>()
  for (const snapshot of (combatData ?? []) as CharacterCombatSnapshot[]) {
    hpByCharacterId.set(snapshot.character_id, computeMaxHp(snapshot))
  }

  const pairings: Record<string, unknown>[] = []
  for (let i = 0; i < bracketSize / 2; i += 1) {
    const a = contestants[i * 2]
    const b = contestants[i * 2 + 1]

    if (!a) continue // shouldn't happen (byes are only ever the trailing slot), defensive skip

    if (!b) {
      pairings.push({ character_a_id: a.characterId, character_a_name: a.characterName })
      continue
    }

    pairings.push({
      character_a_id: a.characterId,
      character_a_name: a.characterName,
      character_a_hp: hpByCharacterId.get(a.characterId) ?? 1,
      character_b_id: b.characterId,
      character_b_name: b.characterName,
      character_b_hp: hpByCharacterId.get(b.characterId) ?? 1,
    })
  }

  const { error: writeError } = await db.rpc('pvp_tournament_write_round', {
    p_tournament_id: tournamentId,
    p_round: round,
    p_pairings: pairings,
  })

  if (writeError) {
    console.error('pvp-tournament-advance write_round failed:', writeError.message)
    return json({ ok: false, error: 'query_failed', detail: writeError.message }, 500)
  }

  return json({ ok: true, matches: pairings.length })
}
