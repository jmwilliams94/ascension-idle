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
  goldReward: number
  expReward: number
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
  // '/ascension-idle/' GitHub Pages base path, not just local dev. Optional —
  // every other monster still falls back to the plain color swatch (see
  // CombatPage's portrait rendering) until it gets its own art.
  portraitUrl?: string
}

export const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeDef> = {
  // --- Windhollow ---
  'quailwing': {
    id: 'quailwing',
    displayName: 'Quailwing',
    level: 1,
    maxHp: 24,
    goldReward: 2,
    expReward: 5,
    attackDamage: 4,
    color: 0x93c5fd,
    portraitUrl: `${import.meta.env.BASE_URL}monsters/quailwing.png`,
  },
  'mourning-dove': { id: 'mourning-dove', displayName: 'Mourning Dove', level: 7, maxHp: 48, goldReward: 3, expReward: 7, attackDamage: 7, color: 0xd6d3d1 },
  'redbreast': { id: 'redbreast', displayName: 'Redbreast', level: 12, maxHp: 72, goldReward: 4, expReward: 9, attackDamage: 11, color: 0xdc2626 },
  'warshade': { id: 'warshade', displayName: 'Warshade', level: 20, maxHp: 104, goldReward: 5, expReward: 13, attackDamage: 16, color: 0x94a3b8 },
  'grim-specter': { id: 'grim-specter', displayName: 'Grim Specter', level: 25, maxHp: 136, goldReward: 6, expReward: 15, attackDamage: 20, color: 0x334155 },
  // --- Cinderleaf ---
  'wingfang-serpent': { id: 'wingfang-serpent', displayName: 'Wingfang Serpent', level: 27, maxHp: 144, goldReward: 6, expReward: 16, attackDamage: 22, color: 0x65a30d },
  'brushrunner': { id: 'brushrunner', displayName: 'Brushrunner', level: 32, maxHp: 176, goldReward: 7, expReward: 19, attackDamage: 26, color: 0x78350f },
  'thornreaver': { id: 'thornreaver', displayName: 'Thornreaver', level: 35, maxHp: 192, goldReward: 7, expReward: 20, attackDamage: 29, color: 0x57534e },
  'woodkin': { id: 'woodkin', displayName: 'Woodkin', level: 40, maxHp: 232, goldReward: 8, expReward: 23, attackDamage: 35, color: 0x15803d },
  'woodkin-sovereign': { id: 'woodkin-sovereign', displayName: 'Woodkin Sovereign', level: 45, maxHp: 264, goldReward: 9, expReward: 27, attackDamage: 40, color: 0x166534 },
  // --- Stormvale ---
  'ridgeback-simian': { id: 'ridgeback-simian', displayName: 'Ridgeback Simian', level: 47, maxHp: 280, goldReward: 9, expReward: 28, attackDamage: 42, color: 0x92400e },
  'boulder-ape': { id: 'boulder-ape', displayName: 'Boulder Ape', level: 52, maxHp: 320, goldReward: 10, expReward: 31, attackDamage: 48, color: 0x57534e },
  'bellowing-brute': { id: 'bellowing-brute', displayName: 'Bellowing Brute', level: 55, maxHp: 344, goldReward: 10, expReward: 34, attackDamage: 52, color: 0x451a03 },
  'frostpelt': { id: 'frostpelt', displayName: 'Frostpelt', level: 60, maxHp: 392, goldReward: 11, expReward: 37, attackDamage: 59, color: 0xcbd5e1 },
  'venomkin': { id: 'venomkin', displayName: 'Venomkin', level: 65, maxHp: 432, goldReward: 12, expReward: 41, attackDamage: 65, color: 0x15803d },
  // --- Sunscar Wastes ---
  'dunecrawler': { id: 'dunecrawler', displayName: 'Dunecrawler', level: 67, maxHp: 456, goldReward: 12, expReward: 43, attackDamage: 68, color: 0xd97706 },
  'cragbeast': { id: 'cragbeast', displayName: 'Cragbeast', level: 72, maxHp: 504, goldReward: 13, expReward: 47, attackDamage: 76, color: 0x78716c },
  'boulderback-golem': { id: 'boulderback-golem', displayName: 'Boulderback Golem', level: 75, maxHp: 536, goldReward: 13, expReward: 50, attackDamage: 80, color: 0x57534e },
  'stonewarden': { id: 'stonewarden', displayName: 'Stonewarden', level: 80, maxHp: 584, goldReward: 14, expReward: 55, attackDamage: 88, color: 0x44403c },
  'edgeborn': { id: 'edgeborn', displayName: 'Edgeborn', level: 85, maxHp: 640, goldReward: 15, expReward: 59, attackDamage: 96, color: 0xcbd5e1 },
  // --- Talon Isle ---
  'wingkin': { id: 'wingkin', displayName: 'Wingkin', level: 87, maxHp: 664, goldReward: 15, expReward: 61, attackDamage: 100, color: 0x0ea5e9 },
  'wingkin-sovereign': { id: 'wingkin-sovereign', displayName: 'Wingkin Sovereign', level: 90, maxHp: 704, goldReward: 16, expReward: 64, attackDamage: 106, color: 0x0369a1 },
  'hawklord': { id: 'hawklord', displayName: 'Hawklord', level: 92, maxHp: 728, goldReward: 16, expReward: 66, attackDamage: 109, color: 0x92400e },
  'silverwing': { id: 'silverwing', displayName: 'Silverwing', level: 95, maxHp: 760, goldReward: 16, expReward: 70, attackDamage: 114, color: 0xcbd5e1 },
  'footpad': { id: 'footpad', displayName: 'Footpad', level: 100, maxHp: 824, goldReward: 17, expReward: 75, attackDamage: 124, color: 0x57534e },
  // --- Duskspire Keep ---
  'cryptwing': { id: 'cryptwing', displayName: 'Cryptwing', level: 102, maxHp: 848, goldReward: 17, expReward: 77, attackDamage: 127, color: 0x4c1d95 },
  'crimson-wing': { id: 'crimson-wing', displayName: 'Crimson Wing', level: 107, maxHp: 912, goldReward: 18, expReward: 83, attackDamage: 137, color: 0x991b1b },
  'crimson-sovereign': { id: 'crimson-sovereign', displayName: 'Crimson Sovereign', level: 110, maxHp: 960, goldReward: 19, expReward: 86, attackDamage: 144, color: 0x7f1d1d },
  'ironhorn-fiend': { id: 'ironhorn-fiend', displayName: 'Ironhorn Fiend', level: 115, maxHp: 1024, goldReward: 19, expReward: 92, attackDamage: 154, color: 0x7c2d12 },
  'verdant-fiend': { id: 'verdant-fiend', displayName: 'Verdant Fiend', level: 120, maxHp: 1096, goldReward: 20, expReward: 99, attackDamage: 164, color: 0x166534 },
  // --- Twistpath Ruins ---
  'ratling-flinger': { id: 'ratling-flinger', displayName: 'Ratling Flinger', level: 105, maxHp: 888, goldReward: 18, expReward: 81, attackDamage: 133, color: 0x57534e },
  'gilded-wraith': { id: 'gilded-wraith', displayName: 'Gilded Wraith', level: 108, maxHp: 928, goldReward: 18, expReward: 84, attackDamage: 139, color: 0xd4af37 },
  'swiftgnaw': { id: 'swiftgnaw', displayName: 'Swiftgnaw', level: 112, maxHp: 984, goldReward: 19, expReward: 89, attackDamage: 148, color: 0x78716c },
  'nightfiend': { id: 'nightfiend', displayName: 'Nightfiend', level: 117, maxHp: 1056, goldReward: 20, expReward: 95, attackDamage: 158, color: 0x1e1b4b },
  'bullhorn-warden': { id: 'bullhorn-warden', displayName: 'Bullhorn Warden', level: 120, maxHp: 1096, goldReward: 20, expReward: 99, attackDamage: 164, color: 0x44403c },
  // --- Rimehollow ---
  'rime-serpent': { id: 'rime-serpent', displayName: 'Rime Serpent', level: 120, maxHp: 1096, goldReward: 20, expReward: 99, attackDamage: 164, color: 0x67e8f9 },
  'serpent-herald': { id: 'serpent-herald', displayName: 'Serpent Herald', level: 122, maxHp: 1128, goldReward: 20, expReward: 101, attackDamage: 169, color: 0x22d3ee },
  'serpent-warden': { id: 'serpent-warden', displayName: 'Serpent Warden', level: 124, maxHp: 1160, goldReward: 21, expReward: 104, attackDamage: 174, color: 0x06b6d4 },
  'fiend-sovereign': { id: 'fiend-sovereign', displayName: 'Fiend Sovereign', level: 127, maxHp: 1208, goldReward: 21, expReward: 108, attackDamage: 181, color: 0x164e63 },
  'frostblade-fiend': { id: 'frostblade-fiend', displayName: 'Frostblade Fiend', level: 129, maxHp: 1232, goldReward: 21, expReward: 110, attackDamage: 185, color: 0x083344 },
}

export interface ZoneDef {
  id: ZoneId
  displayName: string
  monsterOrder: EnemyTypeId[]
  // Kept for the zone picker's UI (disabled entries) — no zone is currently
  // locked (all 8 have full rosters), but the field stays in case a future
  // 9th+ zone is added before it's ready.
  locked: boolean
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  'windhollow': {
    id: 'windhollow',
    displayName: 'Windhollow',
    monsterOrder: ['quailwing', 'mourning-dove', 'redbreast', 'warshade', 'grim-specter'],
    locked: false,
  },
  'cinderleaf': {
    id: 'cinderleaf',
    displayName: 'Cinderleaf',
    monsterOrder: ['wingfang-serpent', 'brushrunner', 'thornreaver', 'woodkin', 'woodkin-sovereign'],
    locked: false,
  },
  'stormvale': {
    id: 'stormvale',
    displayName: 'Stormvale',
    monsterOrder: ['ridgeback-simian', 'boulder-ape', 'bellowing-brute', 'frostpelt', 'venomkin'],
    locked: false,
  },
  'sunscar-wastes': {
    id: 'sunscar-wastes',
    displayName: 'Sunscar Wastes',
    monsterOrder: ['dunecrawler', 'cragbeast', 'boulderback-golem', 'stonewarden', 'edgeborn'],
    locked: false,
  },
  'talon-isle': {
    id: 'talon-isle',
    displayName: 'Talon Isle',
    monsterOrder: ['wingkin', 'wingkin-sovereign', 'hawklord', 'silverwing', 'footpad'],
    locked: false,
  },
  'duskspire-keep': {
    id: 'duskspire-keep',
    displayName: 'Duskspire Keep',
    monsterOrder: ['cryptwing', 'crimson-wing', 'crimson-sovereign', 'ironhorn-fiend', 'verdant-fiend'],
    locked: false,
  },
  'twistpath-ruins': {
    id: 'twistpath-ruins',
    displayName: 'Twistpath Ruins',
    monsterOrder: ['ratling-flinger', 'gilded-wraith', 'swiftgnaw', 'nightfiend', 'bullhorn-warden'],
    locked: false,
  },
  'rimehollow': {
    id: 'rimehollow',
    displayName: 'Rimehollow',
    monsterOrder: ['rime-serpent', 'serpent-herald', 'serpent-warden', 'fiend-sovereign', 'frostblade-fiend'],
    locked: false,
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
