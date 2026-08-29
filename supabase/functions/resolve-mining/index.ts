// Mining node resolution — server-authoritative sibling to resolve-combat,
// gather/apply-split (resolve_mining_gather_state / resolve_mining_apply_results
// / resolve_mining_release_claim, see supabase/migrations/20260927000000_add_resolve_mining.sql)
// but deliberately simpler: a mining node has no dodge/hit-chance, no
// attack-back, no player HP, no EXP, no gear durability, and damage comes
// from the character's own Pickaxe (template physical_attack + composition
// bonus) rather than class attributes + equipped combat gear. See
// CLAUDE.md's Mining design writeup and plan jazzy-napping-globe.
//
// Reward model — same closed-form cycle-time math resolve-combat/index.ts
// uses (dps -> timeToKillMs -> cycleTimeMs -> expectedKillsThisWindow), just
// without the overkill-cap/rare-blend machinery (mining has no rare-node
// concept). No persisted fractional-kill carry-forward across windows
// (unlike character_monster_kills' numeric columns) — a known, accepted
// simplification for v1; a live session reconciled every ~4s can lose a
// small fraction of a kill's progress each window. Fine to add a carry-
// forward column later if this proves to matter in practice.
//
// Ore drops are real item_instances rows (live) / loot_holding rows
// (offline), identical branching to resolve_combat_apply_results' own
// p_item_drops loop. Gems always apply as a direct characters.gems delta,
// live or offline alike — see the migration header for why (gems are an
// uncapped fungible counter, no Inventory-slot concept at the storage layer).

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!

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
    return await handleResolveMining(req)
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    console.error('resolve-mining unhandled exception:', detail)
    return json({ ok: false, error: 'unhandled_exception', detail }, 500)
  }
})

// ---------------------------------------------------------------------------
// Mirrors src/game/items/equipmentBonus.ts's PICKAXE_QUALITY_MULTIPLIERS
// (2026-08-27, requested by the user) — Pickaxe-only, deliberately steeper
// than every other gear slot's own QUALITY_STAT_MULTIPLIERS curve, since the
// Pickaxe never enters combat's shared multiplier math at all.
// ---------------------------------------------------------------------------
const PICKAXE_QUALITY_MULTIPLIERS: Record<string, number> = {
  normal: 1,
  tempered: 2,
  infused: 3,
  radiant: 4,
  ascended: 5,
}

// Raised 5% -> 10% (2026-11) — must stay in sync with equipmentBonus.ts.
const COMPOSITION_BONUS_PCT_PER_TIER = 0.1

const MIN_DAMAGE_PERCENT_OF_ATTACK = 0.1

function resolvePhysicalDamage(attack: number, defense: number): number {
  const mitigated = attack - defense
  const floor = Math.round(attack * MIN_DAMAGE_PERCENT_OF_ATTACK)
  return Math.max(mitigated, floor, 1)
}

const MINING_ATTACK_INTERVAL_MS = 1000
const MINING_RESPAWN_GAP_MS = 10_000
// Flat v1 AFK cap — combat's own account-tier-scaled table
// (AFK_CAP_MS_BY_ACCOUNT_TIER) isn't mirrored here yet; a reasonable
// fast-follow once mining has its own progression signal to key off of.
const MINING_AFK_CAP_MS = 2 * 60 * 60 * 1000

const INVENTORY_SLOT_CAP = 40
const LOOT_HOLDING_CAP = 100

// Rarest-first, first hit wins, else Ore — same shape as resolve-combat's
// own QUALITY_DROP_CHANCES/rollDroppedQualityTier.
const GEM_TIER_DROP_CHANCES: [tier: string, chance: number][] = [
  ['ascended', 1 / 4000],
  ['tempered', 1 / 1000],
  ['normal', 1 / 400],
]

function rollMiningGemTier(): string | null {
  for (const [tier, chance] of GEM_TIER_DROP_CHANCES) {
    if (Math.random() < chance) return tier
  }
  return null
}

const ORE_TYPES = ['Iron', 'Silver', 'Gold'] as const

// Umbrite Ore (2026-08-22, requested by the user) — a real, pre-existing
// item_templates row (item_family/slot_type 'promotion-material',
// required_level 40, price 0), used as Falcon Hunter's tier-40 promotion
// cost (see CLAUDE.accounts-and-classes.md). Documented since 2026-09-01 as
// "intended as a future Mining drop... no acquisition path exists yet" —
// this closes that gap. Scoped to Cinderleaf only, per the user — checked
// against node.mine_id, not a DB column (same plain-constant shape
// combatResolver.ts's own JADE_SHARD_MONSTER_IDS uses for its own
// single-material-scoped-to-specific-sources drop). Placeholder rate,
// matching Jade Shard's own precedent for a promotion-tier-gating special
// material (JADE_SHARD_DROP_CHANCE = 1/300). Quality-locked already by its
// slot_type (Forge's quality_upgrade/master_forge_upgrade both explicitly
// reject 'promotion-material') — granted the same way regular Ore is
// (quality_tier 'normal', composition_level 0), so "no ore can have a
// quality" holds for this one too with no extra code.
const UMBRITE_ORE_NAME = 'Umbrite Ore'
const UMBRITE_ORE_DROP_CHANCE = 1 / 300
const UMBRITE_ORE_MINE_ID = 'cinderleaf'

// P(rank = N) proportional to (11 - N) -- low ranks common, Rank 10 rare.
// Placeholder weighting, tunable.
function rollOreRank(): number {
  const totalWeight = 55 // sum of (11-N) for N=1..10
  let r = Math.random() * totalWeight
  for (let rank = 1; rank <= 10; rank += 1) {
    const weight = 11 - rank
    if (r < weight) return rank
    r -= weight
  }
  return 10
}

interface CharacterSnapshot {
  id: string
  account_id: string
  gold: number
  gems: Record<string, number> | null
  selected_mine_id: string | null
  mining_last_resolved_at: string
}

interface PickaxeSnapshot {
  id: string
  template_id: string
  quality_tier: string
  composition_level: number
  physical_attack: number
}

interface NodeSnapshot {
  id: string
  display_name: string
  mine_id: string
  max_hp: number
  defense: number
  gem_pool: string[]
}

interface GatherStateResult {
  ok: boolean
  error?: string
  claimed?: boolean
  claimed_at?: string
  restore_at?: string
  character?: CharacterSnapshot
  pickaxe?: PickaxeSnapshot | null
  node?: NodeSnapshot | null
  gear_count?: number
  holding_count?: number
}

interface OreTemplateRow {
  id: string
  name: string
  required_level: number
}

async function handleResolveMining(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ ok: false, error: 'not_authenticated' }, 401)
  }

  let characterId: string | undefined
  let mode: string | undefined
  try {
    const body = await req.json()
    characterId = body.characterId
    mode = body.mode
  } catch {
    // fall through to the missing-field checks below
  }

  if (!characterId) {
    return json({ ok: false, error: 'missing_character_id' }, 400)
  }
  if (mode !== 'live' && mode !== 'offline') {
    return json({ ok: false, error: 'invalid_mode' }, 400)
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

  const { data: gatherData, error: gatherError } = await db.rpc('resolve_mining_gather_state', {
    p_character_id: characterId,
  })

  if (gatherError || !gatherData) {
    console.error('resolve-mining gather failed:', gatherError?.message)
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

  const releaseClaim = async (reason: string) => {
    if (!gathered.claimed || !gathered.claimed_at || !gathered.restore_at) return
    const { error } = await db.rpc('resolve_mining_release_claim', {
      p_character_id: characterId,
      p_claimed_at: gathered.claimed_at,
      p_restore_to: gathered.restore_at,
    })
    if (error) console.error(`resolve-mining release_claim failed (${reason}):`, error.message)
  }

  try {
    if (!gathered.claimed) {
      // Another concurrent call already claimed this window.
      return json({ ok: true, elapsedMs: 0, gained: { kills: 0, ore: 0, umbriteOre: 0, gems: 0 } })
    }

    if (!character.selected_mine_id) {
      return json({ ok: true, elapsedMs: 0, gained: { kills: 0, ore: 0, umbriteOre: 0, gems: 0 } })
    }

    const node = gathered.node
    if (!node) {
      await releaseClaim('no_node')
      return json({ ok: false, error: 'unknown_mine' }, 500)
    }

    const pickaxe = gathered.pickaxe
    if (!pickaxe) {
      // Expected business state (nothing pickaxe-family equipped in the
      // Main Hand weapon slot), not a server error — default 200 status,
      // same treatment world-boss-attack gives 'quiver_required'. The
      // client pre-disables Mine/Tier Up in that case too, so this is a
      // defense-in-depth path.
      await releaseClaim('no_pickaxe')
      return json({ ok: false, error: 'no_pickaxe' })
    }

    const lastResolvedMs = new Date(character.mining_last_resolved_at).getTime()
    const claimedMs = new Date(gathered.claimed_at!).getTime()
    const elapsedMs = Math.min(Math.max(claimedMs - lastResolvedMs, 0), MINING_AFK_CAP_MS)

    // No class/attributes/other-equipped-gear involved at all — deliberately
    // "none of the user's equipped gear" per the design spec. Quality tier
    // genuinely varies now (2026-09-30, requested by the user — Tier Up
    // bumps it directly instead of swapping templates), so it's read off the
    // real equipped item rather than assumed 'normal'. Composition bonus
    // uses the same flat 5%/tier-of-raw-base-stat formula every other gear
    // slot uses.
    const scaledAttack = Math.round(pickaxe.physical_attack * (PICKAXE_QUALITY_MULTIPLIERS[pickaxe.quality_tier] ?? 1))
    const compositionBonus = Math.round(pickaxe.physical_attack * COMPOSITION_BONUS_PCT_PER_TIER * pickaxe.composition_level)
    const attackMidpoint = scaledAttack + compositionBonus

    const expectedDamagePerHit = resolvePhysicalDamage(attackMidpoint, node.defense)
    const dps = expectedDamagePerHit / MINING_ATTACK_INTERVAL_MS
    const timeToKillMs = node.max_hp / dps
    const cycleTimeMs = timeToKillMs + MINING_RESPAWN_GAP_MS
    const expectedKillsThisWindow = elapsedMs / cycleTimeMs
    const wholeKillsThisWindow = Math.max(0, Math.floor(expectedKillsThisWindow))

    let gearCount = gathered.gear_count ?? 0
    let holdingCount = gathered.holding_count ?? 0

    let oreGrantedThisWindow = 0
    let umbriteOreGrantedThisWindow = 0
    let gemsGrantedThisWindow = 0
    let inventoryFull = false
    const oreRolls: { type: (typeof ORE_TYPES)[number]; rank: number }[] = []
    const gemGrants: Record<string, number> = {}
    const isUmbriteMine = node.mine_id === UMBRITE_ORE_MINE_ID

    for (let i = 0; i < wholeKillsThisWindow; i += 1) {
      const gemTier = rollMiningGemTier()
      if (gemTier) {
        const gemId = node.gem_pool[Math.floor(Math.random() * node.gem_pool.length)]
        if (gemId) {
          const key = `${gemId}_${gemTier}`
          gemGrants[key] = (gemGrants[key] ?? 0) + 1
          gemsGrantedThisWindow += 1
        }
        continue
      }

      // Live mode stops the moment a drop can't fit — mirrors resolve-combat.
      if (mode === 'live' && gearCount >= INVENTORY_SLOT_CAP) {
        inventoryFull = true
        break
      }
      if (mode === 'offline' && holdingCount >= LOOT_HOLDING_CAP) {
        break
      }

      if (isUmbriteMine && Math.random() < UMBRITE_ORE_DROP_CHANCE) {
        umbriteOreGrantedThisWindow += 1
      } else {
        const oreType = ORE_TYPES[Math.floor(Math.random() * ORE_TYPES.length)]
        const rank = rollOreRank()
        oreRolls.push({ type: oreType, rank })
        oreGrantedThisWindow += 1
      }

      if (mode === 'live') {
        gearCount += 1
      } else {
        holdingCount += 1
      }
    }

    // One lookup query for whichever ore/Umbrite templates are actually
    // needed this window, rather than one query per roll.
    let templateByName = new Map<string, { id: string; requiredLevel: number }>()
    const neededNames = oreRolls.map(({ type, rank }) => `${type} Ore (Rank ${rank})`)
    if (umbriteOreGrantedThisWindow > 0) {
      neededNames.push(UMBRITE_ORE_NAME)
    }
    if (neededNames.length > 0) {
      const { data: oreTemplates, error: oreError } = await db
        .from('item_templates')
        .select('id, name, required_level')
        .in('name', Array.from(new Set(neededNames)))

      if (oreError) {
        console.error('resolve-mining ore template lookup failed:', oreError.message)
      } else {
        templateByName = new Map(
          (oreTemplates as OreTemplateRow[]).map((t) => [t.name, { id: t.id, requiredLevel: t.required_level }]),
        )
      }
    }

    const oreDrops = [
      ...oreRolls.map(({ type, rank }) => templateByName.get(`${type} Ore (Rank ${rank})`)),
      ...Array.from({ length: umbriteOreGrantedThisWindow }, () => templateByName.get(UMBRITE_ORE_NAME)),
    ]
      .filter((t): t is { id: string; requiredLevel: number } => Boolean(t))
      .map((t) => ({ template_id: t.id, required_level: t.requiredLevel }))

    const gemDrops = Object.entries(gemGrants).map(([gemKey, amount]) => ({ gem_key: gemKey, amount }))

    const { data: applyData, error: applyError } = await db.rpc('resolve_mining_apply_results', {
      p_character_id: characterId,
      p_mode: mode,
      p_gem_drops: gemDrops,
      p_ore_drops: oreDrops,
    })

    if (applyError || !applyData) {
      console.error('resolve-mining apply failed:', applyError?.message)
      await releaseClaim('apply_failed')
      return json({ ok: false, error: 'query_failed', detail: applyError?.message }, 500)
    }

    return json({
      ok: true,
      elapsedMs,
      gained: {
        kills: wholeKillsThisWindow,
        ore: oreGrantedThisWindow,
        umbriteOre: umbriteOreGrantedThisWindow,
        gems: gemsGrantedThisWindow,
      },
      itemsGranted: mode === 'live' ? applyData.granted_items : [],
      itemsHeld: mode === 'offline' ? oreGrantedThisWindow + umbriteOreGrantedThisWindow : 0,
      gemsGranted: gemGrants,
      gems: applyData.gems,
      inventoryFull,
      nodeMaxHp: node.max_hp,
      nodeDisplayName: node.display_name,
    })
  } catch (err) {
    await releaseClaim('exception')
    throw err
  }
}
