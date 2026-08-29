// Zone/monster names are original designs for Ascension Idle — informed by
// studying real Conquer Online zone/monster pacing (kept as local-only
// reference notes in reference/conquer-items/monsters.md, not part of this
// repo) but independently named and statted, not copied. Supersedes the
// earlier 1-for-1 Conquer rename list (Dual Town/Peacock/etc.) — that list
// is gone entirely, not just relabeled.
export type ZoneId =
  | 'windhollow'
  | 'cinderleaf'
  | 'stormvale'
  | 'sunscar-wastes'
  | 'talon-isle'
  | 'duskspire-keep'
  | 'twistpath-ruins'
  | 'rimehollow'

export type EnemyTypeId =
  // --- Windhollow ---
  | 'quailwing'
  | 'mourning-dove'
  | 'redbreast'
  | 'warshade'
  | 'grim-specter'
  // --- Cinderleaf ---
  | 'wingfang-serpent'
  | 'brushrunner'
  | 'thornreaver'
  | 'woodkin'
  | 'woodkin-sovereign'
  // --- Stormvale ---
  | 'ridgeback-simian'
  | 'boulder-ape'
  | 'bellowing-brute'
  | 'frostpelt'
  | 'venomkin'
  // --- Sunscar Wastes ---
  | 'dunecrawler'
  | 'cragbeast'
  | 'boulderback-golem'
  | 'stonewarden'
  | 'edgeborn'
  // --- Talon Isle ---
  | 'wingkin'
  | 'wingkin-sovereign'
  | 'hawklord'
  | 'silverwing'
  | 'footpad'
  // --- Duskspire Keep ---
  | 'cryptwing'
  | 'crimson-wing'
  | 'crimson-sovereign'
  | 'ironhorn-fiend'
  | 'verdant-fiend'
  // --- Twistpath Ruins ---
  | 'ratling-flinger'
  | 'gilded-wraith'
  | 'swiftgnaw'
  | 'nightfiend'
  | 'bullhorn-warden'
  // --- Rimehollow ---
  | 'rime-serpent'
  | 'serpent-herald'
  | 'serpent-warden'
  | 'fiend-sovereign'
  | 'frostblade-fiend'

export interface EnemyTypeDef {
  id: EnemyTypeId
  displayName: string
  // The monster's own level — compared against the character's level to
  // determine its name color (white/green/red/black) and EXP multiplier, see
  // combatResolver.ts's getLevelDiffColor/expMultiplierForLevelDiff.
  level: number
  // PLACEHOLDER flat stats — independently formula-derived (tied to the same
  // power curve as the Bows in the gear catalog: maxHp is roughly 8x a
  // same-level bow's damage), not sourced/tuned balance.
  maxHp: number
  // Rescaled 2026-08-29 (requested by the user): 10 at level 1 scaling up to
  // ~250 at level 129/130, via `round(10 * 25^((level-1)/129))` — same
  // geometric-interpolation shape as computeRepairCost. Rare kills still get
  // their own 5x multiplier on top (RARE_REWARD_MULTIPLIER), untouched by
  // this change. Mirrored server-side in enemy_types.gold_reward (see
  // 20261110040000_rescale_enemy_gold_rewards.sql) — must stay in sync.
  goldReward: number
  // EXP reward is NOT a field here (removed 2026-08-05) — it's formula-derived
  // from the monster's own level via expRewardForLevel (src/game/stats/
  // expCurve.ts), the same "don't hand-place a stat that can be computed"
  // convention monsterDefense/monsterDodge already use, so it can never drift
  // out of sync with the required-EXP curve the way the old hand-placed
  // values did (see expCurve.ts's own comment for the full story).
  // Flat damage the monster deals back to the player once per second (fixed
  // cadence, not derived from any monster "attack speed" concept — none exists
  // yet). Player HP/knockout handling lives in useCombatStore.runTick.
  attackDamage: number
  // 0xRRGGBB — a Phaser-era convention kept for the placeholder portrait swatch
  // (see CombatPage's hexColor helper).
  color: number
  // Real portrait art, first used for Quailwing (2026-08-01) — a static PNG in
  // public/monsters/, referenced via import.meta.env.BASE_URL (same pattern
  // useAuthStore.ts already uses) so it resolves correctly under the
  // configured Vite base path, not just local dev. Optional — every other
  // monster still falls back to the plain color swatch (see CombatPage's
  // portrait rendering) until it gets its own art.
  portraitUrl?: string
}

export const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeDef> = {
  // --- Windhollow ---
  'quailwing': {
    id: 'quailwing',
    displayName: 'Quailwing',
    level: 1,
    maxHp: 108,
    goldReward: 10,
    attackDamage: 4,
    color: 0x93c5fd,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/quailwing.png`,
  },
  'mourning-dove': {
    id: 'mourning-dove',
    displayName: 'Mourning Dove',
    level: 7,
    maxHp: 120,
    goldReward: 12,
    attackDamage: 7,
    color: 0xd6d3d1,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/mourning-dove.png`,
  },
  'redbreast': {
    id: 'redbreast',
    displayName: 'Redbreast',
    level: 12,
    maxHp: 132,
    goldReward: 13,
    attackDamage: 11,
    color: 0xdc2626,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/redbreast.png`,
  },
  'warshade': {
    id: 'warshade',
    displayName: 'Warshade',
    level: 20,
    maxHp: 162,
    goldReward: 16,
    attackDamage: 16,
    color: 0x94a3b8,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/warshade.png`,
  },
  'grim-specter': {
    id: 'grim-specter',
    displayName: 'Grim Specter',
    level: 25,
    maxHp: 168,
    goldReward: 18,
    attackDamage: 20,
    color: 0x334155,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/grim-specter.png`,
  },
  // --- Cinderleaf ---
  'wingfang-serpent': {
    id: 'wingfang-serpent',
    displayName: 'Wingfang Serpent',
    level: 27,
    maxHp: 168,
    goldReward: 19,
    attackDamage: 22,
    color: 0x65a30d,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/wingfang-serpent.png`,
  },
  'brushrunner': {
    id: 'brushrunner',
    displayName: 'Brushrunner',
    level: 32,
    maxHp: 192,
    goldReward: 22,
    attackDamage: 26,
    color: 0x78350f,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/brushrunner.png`,
  },
  'thornreaver': {
    id: 'thornreaver',
    displayName: 'Thornreaver',
    level: 35,
    maxHp: 198,
    goldReward: 23,
    attackDamage: 29,
    color: 0x57534e,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/thornreaver.png`,
  },
  'woodkin': {
    id: 'woodkin',
    displayName: 'Woodkin',
    level: 40,
    maxHp: 240,
    goldReward: 26,
    attackDamage: 35,
    color: 0x15803d,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/woodkin.png`,
  },
  'woodkin-sovereign': {
    id: 'woodkin-sovereign',
    displayName: 'Woodkin Sovereign',
    level: 45,
    maxHp: 258,
    goldReward: 30,
    attackDamage: 40,
    color: 0x166534,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/woodkin-sovereign.png`,
  },
  // --- Stormvale ---
  'ridgeback-simian': {
    id: 'ridgeback-simian',
    displayName: 'Ridgeback Simian',
    level: 47,
    maxHp: 273,
    goldReward: 32,
    attackDamage: 42,
    color: 0x92400e,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/ridgeback-simian.png`,
  },
  'boulder-ape': {
    id: 'boulder-ape',
    displayName: 'Boulder Ape',
    level: 52,
    maxHp: 306,
    goldReward: 36,
    attackDamage: 48,
    color: 0x57534e,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/boulder-ape.png`,
  },
  'bellowing-brute': {
    id: 'bellowing-brute',
    displayName: 'Bellowing Brute',
    level: 55,
    maxHp: 342,
    goldReward: 38,
    attackDamage: 52,
    color: 0x451a03,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/bellowing-brute.png`,
  },
  'frostpelt': {
    id: 'frostpelt',
    displayName: 'Frostpelt',
    level: 60,
    maxHp: 393,
    goldReward: 44,
    attackDamage: 59,
    color: 0xcbd5e1,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/frostpelt.png`,
  },
  'venomkin': {
    id: 'venomkin',
    displayName: 'Venomkin',
    level: 65,
    maxHp: 438,
    goldReward: 49,
    attackDamage: 65,
    color: 0x15803d,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/venomkin.png`,
  },
  // --- Sunscar Wastes ---
  'dunecrawler': {
    id: 'dunecrawler',
    displayName: 'Dunecrawler',
    level: 67,
    maxHp: 438,
    goldReward: 52,
    attackDamage: 68,
    color: 0xd97706,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/dunecrawler.png`,
  },
  'cragbeast': {
    id: 'cragbeast',
    displayName: 'Cragbeast',
    level: 72,
    maxHp: 528,
    goldReward: 59,
    attackDamage: 76,
    color: 0x78716c,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/cragbeast.png`,
  },
  'boulderback-golem': {
    id: 'boulderback-golem',
    displayName: 'Boulderback Golem',
    level: 75,
    maxHp: 564,
    goldReward: 63,
    attackDamage: 80,
    color: 0x57534e,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/boulderback-golem.png`,
  },
  'stonewarden': {
    id: 'stonewarden',
    displayName: 'Stonewarden',
    level: 80,
    maxHp: 666,
    goldReward: 72,
    attackDamage: 88,
    color: 0x44403c,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/stonewarden.png`,
  },
  'edgeborn': {
    id: 'edgeborn',
    displayName: 'Edgeborn',
    level: 85,
    maxHp: 720,
    goldReward: 81,
    attackDamage: 96,
    color: 0xcbd5e1,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/edgeborn.png`,
  },
  // --- Talon Isle ---
  'wingkin': {
    id: 'wingkin',
    displayName: 'Wingkin',
    level: 87,
    maxHp: 720,
    goldReward: 85,
    attackDamage: 100,
    color: 0x0ea5e9,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/wingkin.png`,
  },
  'wingkin-sovereign': {
    id: 'wingkin-sovereign',
    displayName: 'Wingkin Sovereign',
    level: 90,
    maxHp: 840,
    goldReward: 92,
    attackDamage: 106,
    color: 0x0369a1,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/wingkin-sovereign.png`,
  },
  'hawklord': {
    id: 'hawklord',
    displayName: 'Hawklord',
    level: 92,
    maxHp: 834,
    goldReward: 97,
    attackDamage: 109,
    color: 0x92400e,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/hawklord.png`,
  },
  'silverwing': {
    id: 'silverwing',
    displayName: 'Silverwing',
    level: 95,
    maxHp: 912,
    goldReward: 104,
    attackDamage: 114,
    color: 0xcbd5e1,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/silverwing.png`,
  },
  'footpad': {
    id: 'footpad',
    displayName: 'Footpad',
    level: 100,
    maxHp: 1080,
    goldReward: 118,
    attackDamage: 124,
    color: 0x57534e,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/footpad.png`,
  },
  // --- Duskspire Keep ---
  'cryptwing': {
    id: 'cryptwing',
    displayName: 'Cryptwing',
    level: 102,
    maxHp: 1092,
    goldReward: 124,
    attackDamage: 127,
    color: 0x4c1d95,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/cryptwing.png`,
  },
  'crimson-wing': {
    id: 'crimson-wing',
    displayName: 'Crimson Wing',
    level: 107,
    maxHp: 1194,
    goldReward: 141,
    attackDamage: 137,
    color: 0x991b1b,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/crimson-wing.png`,
  },
  'crimson-sovereign': {
    id: 'crimson-sovereign',
    displayName: 'Crimson Sovereign',
    level: 110,
    maxHp: 1434,
    goldReward: 152,
    attackDamage: 144,
    color: 0x7f1d1d,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/crimson-sovereign.png`,
  },
  'ironhorn-fiend': {
    id: 'ironhorn-fiend',
    displayName: 'Ironhorn Fiend',
    level: 115,
    maxHp: 1566,
    goldReward: 172,
    attackDamage: 154,
    color: 0x7c2d12,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/ironhorn-fiend.png`,
  },
  'verdant-fiend': {
    id: 'verdant-fiend',
    displayName: 'Verdant Fiend',
    level: 120,
    maxHp: 1818,
    goldReward: 195,
    attackDamage: 164,
    color: 0x166534,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/verdant-fiend.png`,
  },
  // --- Twistpath Ruins ---
  'ratling-flinger': {
    id: 'ratling-flinger',
    displayName: 'Hollow Sentinel',
    level: 105,
    maxHp: 1182,
    goldReward: 134,
    attackDamage: 133,
    color: 0x57534e,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/ratling-flinger.png`,
  },
  'gilded-wraith': {
    id: 'gilded-wraith',
    displayName: 'Gilded Wraith',
    level: 108,
    maxHp: 1188,
    goldReward: 144,
    attackDamage: 139,
    color: 0xd4af37,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/gilded-wraith.png`,
  },
  'swiftgnaw': {
    id: 'swiftgnaw',
    displayName: 'Mosswarden',
    level: 112,
    maxHp: 1446,
    goldReward: 160,
    attackDamage: 148,
    color: 0x78716c,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/swiftgnaw.png`,
  },
  'nightfiend': {
    id: 'nightfiend',
    displayName: 'Nightfiend',
    level: 117,
    maxHp: 1686,
    goldReward: 181,
    attackDamage: 158,
    color: 0x1e1b4b,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/nightfiend.png`,
  },
  'bullhorn-warden': {
    id: 'bullhorn-warden',
    displayName: 'Bullhorn Warden',
    level: 120,
    maxHp: 1818,
    goldReward: 195,
    attackDamage: 164,
    color: 0x44403c,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/bullhorn-warden.png`,
  },
  // --- Rimehollow ---
  'rime-serpent': {
    id: 'rime-serpent',
    displayName: 'Rime Serpent',
    level: 120,
    maxHp: 1818,
    goldReward: 195,
    attackDamage: 164,
    color: 0x67e8f9,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/rime-serpent.png`,
  },
  'serpent-herald': {
    id: 'serpent-herald',
    displayName: 'Serpent Herald',
    level: 122,
    maxHp: 1992,
    goldReward: 205,
    attackDamage: 169,
    color: 0x22d3ee,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/serpent-herald.png`,
  },
  'serpent-warden': {
    id: 'serpent-warden',
    displayName: 'Serpent Warden',
    level: 124,
    maxHp: 2046,
    goldReward: 215,
    attackDamage: 174,
    color: 0x06b6d4,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/serpent-warden.png`,
  },
  'fiend-sovereign': {
    id: 'fiend-sovereign',
    displayName: 'Fiend Sovereign',
    level: 127,
    maxHp: 2280,
    goldReward: 232,
    attackDamage: 181,
    color: 0x164e63,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/fiend-sovereign.png`,
  },
  'frostblade-fiend': {
    id: 'frostblade-fiend',
    displayName: 'Frostblade Fiend',
    level: 129,
    maxHp: 2334,
    goldReward: 244,
    attackDamage: 185,
    color: 0x083344,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/frostblade-fiend.png`,
  },
}

export interface ZoneDef {
  id: ZoneId
  displayName: string
  monsterOrder: EnemyTypeId[]
  // Kept for the zone picker's UI (disabled entries) — no zone is currently
  // locked (all 8 have full rosters), but the field stays in case a future
  // 9th+ zone is added before it's ready.
  locked: boolean
  // Optional scene art shown behind the Combat page's monster card (contained
  // to that card, not the full page — see CLAUDE.md). Same import.meta.env.BASE_URL
  // pattern as EnemyTypeDef.portraitUrl. Falls back to a plain dark card when unset.
  backgroundUrl?: string
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  'windhollow': {
    id: 'windhollow',
    displayName: 'Windhollow',
    monsterOrder: ['quailwing', 'mourning-dove', 'redbreast', 'warshade', 'grim-specter'],
    locked: false,
    backgroundUrl: `${import.meta.env.BASE_URL}zones/windhollow.webp`,
  },
  'cinderleaf': {
    id: 'cinderleaf',
    displayName: 'Cinderleaf',
    monsterOrder: ['wingfang-serpent', 'brushrunner', 'thornreaver', 'woodkin', 'woodkin-sovereign'],
    locked: false,
    backgroundUrl: `${import.meta.env.BASE_URL}zones/cinderleaf.webp`,
  },
  'stormvale': {
    id: 'stormvale',
    displayName: 'Stormvale',
    monsterOrder: ['ridgeback-simian', 'boulder-ape', 'bellowing-brute', 'frostpelt', 'venomkin'],
    locked: false,
    backgroundUrl: `${import.meta.env.BASE_URL}zones/stormvale.webp`,
  },
  'sunscar-wastes': {
    id: 'sunscar-wastes',
    displayName: 'Sunscar Wastes',
    monsterOrder: ['dunecrawler', 'cragbeast', 'boulderback-golem', 'stonewarden', 'edgeborn'],
    locked: false,
    backgroundUrl: `${import.meta.env.BASE_URL}zones/sunscar-wastes.webp`,
  },
  'talon-isle': {
    id: 'talon-isle',
    displayName: 'Talon Isle',
    monsterOrder: ['wingkin', 'wingkin-sovereign', 'hawklord', 'silverwing', 'footpad'],
    locked: false,
    backgroundUrl: `${import.meta.env.BASE_URL}zones/talon-isle.webp`,
  },
  'duskspire-keep': {
    id: 'duskspire-keep',
    displayName: 'Duskspire Keep',
    monsterOrder: ['cryptwing', 'crimson-wing', 'crimson-sovereign', 'ironhorn-fiend', 'verdant-fiend'],
    locked: false,
    backgroundUrl: `${import.meta.env.BASE_URL}zones/duskspire-keep.webp`,
  },
  'twistpath-ruins': {
    id: 'twistpath-ruins',
    displayName: 'Twistpath Ruins',
    monsterOrder: ['ratling-flinger', 'gilded-wraith', 'swiftgnaw', 'nightfiend', 'bullhorn-warden'],
    locked: false,
    backgroundUrl: `${import.meta.env.BASE_URL}zones/twistpath-ruins.webp`,
  },
  'rimehollow': {
    id: 'rimehollow',
    displayName: 'Rimehollow',
    monsterOrder: ['rime-serpent', 'serpent-herald', 'serpent-warden', 'fiend-sovereign', 'frostblade-fiend'],
    locked: false,
    backgroundUrl: `${import.meta.env.BASE_URL}zones/rimehollow.webp`,
  },
}

// Display/selection order in the zone picker — ascending by level range.
export const ZONE_ORDER: ZoneId[] = [
  'windhollow',
  'cinderleaf',
  'stormvale',
  'sunscar-wastes',
  'talon-isle',
  'duskspire-keep',
  'twistpath-ruins',
  'rimehollow',
]

export const DEFAULT_ZONE_ID: ZoneId = 'windhollow'

// Reverse lookup (2026-08-07, added for the per-zone Achievements drop-bonus
// feature — see achievementData.ts/useCombatStore.ts's own predictive
// mirror of resolve-combat's zone-scoped accountDropMultiplier) — which
// zone a given monster belongs to, or null for an unrecognized id.
export function zoneIdForMonster(monsterId: EnemyTypeId): ZoneId | null {
  for (const zoneId of ZONE_ORDER) {
    if (ZONES[zoneId].monsterOrder.includes(monsterId)) {
      return zoneId
    }
  }
  return null
}
