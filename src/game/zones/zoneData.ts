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
  | 'crested-cockerel'
  | 'mourning-dove'
  | 'azure-coo'
  | 'redbreast'
  | 'bramble-fowl'
  | 'palewisp'
  | 'warshade'
  | 'restless-shade'
  | 'gravewight'
  | 'grim-specter'
  // --- Cinderleaf ---
  | 'wingfang-serpent'
  | 'cinderscale'
  | 'brushrunner'
  | 'thornreaver'
  | 'emberpaw'
  | 'woodkin'
  | 'cinderwisp'
  | 'woodkin-sovereign'
  // --- Stormvale ---
  | 'ridgeback-simian'
  | 'cunning-simian'
  | 'boulder-ape'
  | 'bellowing-brute'
  | 'stormfist'
  | 'frostpelt'
  | 'coilkin'
  | 'venomkin'
  // --- Sunscar Wastes ---
  | 'dunecrawler'
  | 'duststalker'
  | 'cragbeast'
  | 'boulderback-golem'
  | 'stonewarden'
  | 'bladewraith'
  | 'edgeborn'
  // --- Talon Isle ---
  | 'wingkin'
  | 'wingkin-sovereign'
  | 'hawklord'
  | 'silverwing'
  | 'cutpurse'
  | 'footpad'
  // --- Duskspire Keep ---
  | 'cryptwing'
  | 'crimson-wing'
  | 'crimson-sovereign'
  | 'ironhorn'
  | 'ironhorn-fiend'
  | 'scarlet-fiend'
  | 'verdant-fiend'
  // --- Twistpath Ruins ---
  | 'ratling-flinger'
  | 'gilded-wraith'
  | 'shivshade'
  | 'swiftgnaw'
  | 'azurewing'
  | 'nightfiend'
  | 'bullhorn-warden'
  // --- Rimehollow ---
  | 'rime-serpent'
  | 'rime-fiend'
  | 'serpent-herald'
  | 'fiend-herald'
  | 'serpent-warden'
  | 'fiend-warden'
  | 'serpent-sovereign'
  | 'fiend-sovereign'
  | 'frostcoil'
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
}

export const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeDef> = {
  // --- Windhollow ---
  'quailwing': { id: 'quailwing', displayName: 'Quailwing', level: 1, maxHp: 24, goldReward: 2, expReward: 5, attackDamage: 4, color: 0x93c5fd },
  'crested-cockerel': { id: 'crested-cockerel', displayName: 'Crested Cockerel', level: 3, maxHp: 32, goldReward: 2, expReward: 6, attackDamage: 5, color: 0xb45309 },
  'mourning-dove': { id: 'mourning-dove', displayName: 'Mourning Dove', level: 7, maxHp: 48, goldReward: 3, expReward: 7, attackDamage: 7, color: 0xd6d3d1 },
  'azure-coo': { id: 'azure-coo', displayName: 'Azure Coo', level: 10, maxHp: 64, goldReward: 4, expReward: 8, attackDamage: 10, color: 0x38bdf8 },
  'redbreast': { id: 'redbreast', displayName: 'Redbreast', level: 12, maxHp: 72, goldReward: 4, expReward: 9, attackDamage: 11, color: 0xdc2626 },
  'bramble-fowl': { id: 'bramble-fowl', displayName: 'Bramble Fowl', level: 15, maxHp: 80, goldReward: 4, expReward: 10, attackDamage: 12, color: 0xa16207 },
  'palewisp': { id: 'palewisp', displayName: 'Palewisp', level: 17, maxHp: 96, goldReward: 5, expReward: 11, attackDamage: 14, color: 0xe2e8f0 },
  'warshade': { id: 'warshade', displayName: 'Warshade', level: 20, maxHp: 104, goldReward: 5, expReward: 13, attackDamage: 16, color: 0x94a3b8 },
  'restless-shade': { id: 'restless-shade', displayName: 'Restless Shade', level: 22, maxHp: 120, goldReward: 5, expReward: 14, attackDamage: 18, color: 0x64748b },
  'gravewight': { id: 'gravewight', displayName: 'Gravewight', level: 23, maxHp: 120, goldReward: 5, expReward: 14, attackDamage: 18, color: 0x475569 },
  'grim-specter': { id: 'grim-specter', displayName: 'Grim Specter', level: 25, maxHp: 136, goldReward: 6, expReward: 15, attackDamage: 20, color: 0x334155 },
  // --- Cinderleaf ---
  'wingfang-serpent': { id: 'wingfang-serpent', displayName: 'Wingfang Serpent', level: 27, maxHp: 144, goldReward: 6, expReward: 16, attackDamage: 22, color: 0x65a30d },
  'cinderscale': { id: 'cinderscale', displayName: 'Cinderscale', level: 30, maxHp: 160, goldReward: 7, expReward: 18, attackDamage: 24, color: 0xea580c },
  'brushrunner': { id: 'brushrunner', displayName: 'Brushrunner', level: 32, maxHp: 176, goldReward: 7, expReward: 19, attackDamage: 26, color: 0x78350f },
  'thornreaver': { id: 'thornreaver', displayName: 'Thornreaver', level: 35, maxHp: 192, goldReward: 7, expReward: 20, attackDamage: 29, color: 0x57534e },
  'emberpaw': { id: 'emberpaw', displayName: 'Emberpaw', level: 37, maxHp: 208, goldReward: 8, expReward: 22, attackDamage: 31, color: 0xc2410c },
  'woodkin': { id: 'woodkin', displayName: 'Woodkin', level: 40, maxHp: 232, goldReward: 8, expReward: 23, attackDamage: 35, color: 0x15803d },
  'cinderwisp': { id: 'cinderwisp', displayName: 'Cinderwisp', level: 42, maxHp: 240, goldReward: 8, expReward: 25, attackDamage: 36, color: 0xf97316 },
  'woodkin-sovereign': { id: 'woodkin-sovereign', displayName: 'Woodkin Sovereign', level: 45, maxHp: 264, goldReward: 9, expReward: 27, attackDamage: 40, color: 0x166534 },
  // --- Stormvale ---
  'ridgeback-simian': { id: 'ridgeback-simian', displayName: 'Ridgeback Simian', level: 47, maxHp: 280, goldReward: 9, expReward: 28, attackDamage: 42, color: 0x92400e },
  'cunning-simian': { id: 'cunning-simian', displayName: 'Cunning Simian', level: 50, maxHp: 304, goldReward: 10, expReward: 30, attackDamage: 46, color: 0x78716c },
  'boulder-ape': { id: 'boulder-ape', displayName: 'Boulder Ape', level: 52, maxHp: 320, goldReward: 10, expReward: 31, attackDamage: 48, color: 0x57534e },
  'bellowing-brute': { id: 'bellowing-brute', displayName: 'Bellowing Brute', level: 55, maxHp: 344, goldReward: 10, expReward: 34, attackDamage: 52, color: 0x451a03 },
  'stormfist': { id: 'stormfist', displayName: 'Stormfist', level: 57, maxHp: 360, goldReward: 11, expReward: 35, attackDamage: 54, color: 0x374151 },
  'frostpelt': { id: 'frostpelt', displayName: 'Frostpelt', level: 60, maxHp: 392, goldReward: 11, expReward: 37, attackDamage: 59, color: 0xcbd5e1 },
  'coilkin': { id: 'coilkin', displayName: 'Coilkin', level: 62, maxHp: 408, goldReward: 11, expReward: 39, attackDamage: 61, color: 0x4d7c0f },
  'venomkin': { id: 'venomkin', displayName: 'Venomkin', level: 65, maxHp: 432, goldReward: 12, expReward: 41, attackDamage: 65, color: 0x15803d },
  // --- Sunscar Wastes ---
  'dunecrawler': { id: 'dunecrawler', displayName: 'Dunecrawler', level: 67, maxHp: 456, goldReward: 12, expReward: 43, attackDamage: 68, color: 0xd97706 },
  'duststalker': { id: 'duststalker', displayName: 'Duststalker', level: 70, maxHp: 480, goldReward: 13, expReward: 46, attackDamage: 72, color: 0xb45309 },
  'cragbeast': { id: 'cragbeast', displayName: 'Cragbeast', level: 72, maxHp: 504, goldReward: 13, expReward: 47, attackDamage: 76, color: 0x78716c },
  'boulderback-golem': { id: 'boulderback-golem', displayName: 'Boulderback Golem', level: 75, maxHp: 536, goldReward: 13, expReward: 50, attackDamage: 80, color: 0x57534e },
  'stonewarden': { id: 'stonewarden', displayName: 'Stonewarden', level: 80, maxHp: 584, goldReward: 14, expReward: 55, attackDamage: 88, color: 0x44403c },
  'bladewraith': { id: 'bladewraith', displayName: 'Bladewraith', level: 82, maxHp: 608, goldReward: 14, expReward: 56, attackDamage: 91, color: 0x94a3b8 },
  'edgeborn': { id: 'edgeborn', displayName: 'Edgeborn', level: 85, maxHp: 640, goldReward: 15, expReward: 59, attackDamage: 96, color: 0xcbd5e1 },
  // --- Talon Isle ---
  'wingkin': { id: 'wingkin', displayName: 'Wingkin', level: 87, maxHp: 664, goldReward: 15, expReward: 61, attackDamage: 100, color: 0x0ea5e9 },
  'wingkin-sovereign': { id: 'wingkin-sovereign', displayName: 'Wingkin Sovereign', level: 90, maxHp: 704, goldReward: 16, expReward: 64, attackDamage: 106, color: 0x0369a1 },
  'hawklord': { id: 'hawklord', displayName: 'Hawklord', level: 92, maxHp: 728, goldReward: 16, expReward: 66, attackDamage: 109, color: 0x92400e },
  'silverwing': { id: 'silverwing', displayName: 'Silverwing', level: 95, maxHp: 760, goldReward: 16, expReward: 70, attackDamage: 114, color: 0xcbd5e1 },
  'cutpurse': { id: 'cutpurse', displayName: 'Cutpurse', level: 97, maxHp: 784, goldReward: 17, expReward: 72, attackDamage: 118, color: 0x44403c },
  'footpad': { id: 'footpad', displayName: 'Footpad', level: 100, maxHp: 824, goldReward: 17, expReward: 75, attackDamage: 124, color: 0x57534e },
  // --- Duskspire Keep ---
  'cryptwing': { id: 'cryptwing', displayName: 'Cryptwing', level: 102, maxHp: 848, goldReward: 17, expReward: 77, attackDamage: 127, color: 0x4c1d95 },
  'crimson-wing': { id: 'crimson-wing', displayName: 'Crimson Wing', level: 107, maxHp: 912, goldReward: 18, expReward: 83, attackDamage: 137, color: 0x991b1b },
  'crimson-sovereign': { id: 'crimson-sovereign', displayName: 'Crimson Sovereign', level: 110, maxHp: 960, goldReward: 19, expReward: 86, attackDamage: 144, color: 0x7f1d1d },
  'ironhorn': { id: 'ironhorn', displayName: 'Ironhorn', level: 112, maxHp: 984, goldReward: 19, expReward: 89, attackDamage: 148, color: 0x44403c },
  'ironhorn-fiend': { id: 'ironhorn-fiend', displayName: 'Ironhorn Fiend', level: 115, maxHp: 1024, goldReward: 19, expReward: 92, attackDamage: 154, color: 0x7c2d12 },
  'scarlet-fiend': { id: 'scarlet-fiend', displayName: 'Scarlet Fiend', level: 117, maxHp: 1056, goldReward: 20, expReward: 95, attackDamage: 158, color: 0xb91c1c },
  'verdant-fiend': { id: 'verdant-fiend', displayName: 'Verdant Fiend', level: 120, maxHp: 1096, goldReward: 20, expReward: 99, attackDamage: 164, color: 0x166534 },
  // --- Twistpath Ruins ---
  'ratling-flinger': { id: 'ratling-flinger', displayName: 'Ratling Flinger', level: 105, maxHp: 888, goldReward: 18, expReward: 81, attackDamage: 133, color: 0x57534e },
  'gilded-wraith': { id: 'gilded-wraith', displayName: 'Gilded Wraith', level: 108, maxHp: 928, goldReward: 18, expReward: 84, attackDamage: 139, color: 0xd4af37 },
  'shivshade': { id: 'shivshade', displayName: 'Shivshade', level: 110, maxHp: 960, goldReward: 19, expReward: 86, attackDamage: 144, color: 0x475569 },
  'swiftgnaw': { id: 'swiftgnaw', displayName: 'Swiftgnaw', level: 112, maxHp: 984, goldReward: 19, expReward: 89, attackDamage: 148, color: 0x78716c },
  'azurewing': { id: 'azurewing', displayName: 'Azurewing', level: 115, maxHp: 1024, goldReward: 19, expReward: 92, attackDamage: 154, color: 0x2563eb },
  'nightfiend': { id: 'nightfiend', displayName: 'Nightfiend', level: 117, maxHp: 1056, goldReward: 20, expReward: 95, attackDamage: 158, color: 0x1e1b4b },
  'bullhorn-warden': { id: 'bullhorn-warden', displayName: 'Bullhorn Warden', level: 120, maxHp: 1096, goldReward: 20, expReward: 99, attackDamage: 164, color: 0x44403c },
  // --- Rimehollow ---
  'rime-serpent': { id: 'rime-serpent', displayName: 'Rime Serpent', level: 120, maxHp: 1096, goldReward: 20, expReward: 99, attackDamage: 164, color: 0x67e8f9 },
  'rime-fiend': { id: 'rime-fiend', displayName: 'Rime Fiend', level: 121, maxHp: 1112, goldReward: 20, expReward: 100, attackDamage: 167, color: 0x0e7490 },
  'serpent-herald': { id: 'serpent-herald', displayName: 'Serpent Herald', level: 122, maxHp: 1128, goldReward: 20, expReward: 101, attackDamage: 169, color: 0x22d3ee },
  'fiend-herald': { id: 'fiend-herald', displayName: 'Fiend Herald', level: 123, maxHp: 1144, goldReward: 20, expReward: 102, attackDamage: 172, color: 0x0891b2 },
  'serpent-warden': { id: 'serpent-warden', displayName: 'Serpent Warden', level: 124, maxHp: 1160, goldReward: 21, expReward: 104, attackDamage: 174, color: 0x06b6d4 },
  'fiend-warden': { id: 'fiend-warden', displayName: 'Fiend Warden', level: 125, maxHp: 1176, goldReward: 21, expReward: 105, attackDamage: 176, color: 0x155e75 },
  'serpent-sovereign': { id: 'serpent-sovereign', displayName: 'Serpent Sovereign', level: 126, maxHp: 1192, goldReward: 21, expReward: 106, attackDamage: 179, color: 0xa5f3fc },
  'fiend-sovereign': { id: 'fiend-sovereign', displayName: 'Fiend Sovereign', level: 127, maxHp: 1208, goldReward: 21, expReward: 108, attackDamage: 181, color: 0x164e63 },
  'frostcoil': { id: 'frostcoil', displayName: 'Frostcoil', level: 128, maxHp: 1224, goldReward: 21, expReward: 109, attackDamage: 184, color: 0xcffafe },
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
    monsterOrder: ['quailwing', 'crested-cockerel', 'mourning-dove', 'azure-coo', 'redbreast', 'bramble-fowl', 'palewisp', 'warshade', 'restless-shade', 'gravewight', 'grim-specter'],
    locked: false,
  },
  'cinderleaf': {
    id: 'cinderleaf',
    displayName: 'Cinderleaf',
    monsterOrder: ['wingfang-serpent', 'cinderscale', 'brushrunner', 'thornreaver', 'emberpaw', 'woodkin', 'cinderwisp', 'woodkin-sovereign'],
    locked: false,
  },
  'stormvale': {
    id: 'stormvale',
    displayName: 'Stormvale',
    monsterOrder: ['ridgeback-simian', 'cunning-simian', 'boulder-ape', 'bellowing-brute', 'stormfist', 'frostpelt', 'coilkin', 'venomkin'],
    locked: false,
  },
  'sunscar-wastes': {
    id: 'sunscar-wastes',
    displayName: 'Sunscar Wastes',
    monsterOrder: ['dunecrawler', 'duststalker', 'cragbeast', 'boulderback-golem', 'stonewarden', 'bladewraith', 'edgeborn'],
    locked: false,
  },
  'talon-isle': {
    id: 'talon-isle',
    displayName: 'Talon Isle',
    monsterOrder: ['wingkin', 'wingkin-sovereign', 'hawklord', 'silverwing', 'cutpurse', 'footpad'],
    locked: false,
  },
  'duskspire-keep': {
    id: 'duskspire-keep',
    displayName: 'Duskspire Keep',
    monsterOrder: ['cryptwing', 'crimson-wing', 'crimson-sovereign', 'ironhorn', 'ironhorn-fiend', 'scarlet-fiend', 'verdant-fiend'],
    locked: false,
  },
  'twistpath-ruins': {
    id: 'twistpath-ruins',
    displayName: 'Twistpath Ruins',
    monsterOrder: ['ratling-flinger', 'gilded-wraith', 'shivshade', 'swiftgnaw', 'azurewing', 'nightfiend', 'bullhorn-warden'],
    locked: false,
  },
  'rimehollow': {
    id: 'rimehollow',
    displayName: 'Rimehollow',
    monsterOrder: ['rime-serpent', 'rime-fiend', 'serpent-herald', 'fiend-herald', 'serpent-warden', 'fiend-warden', 'serpent-sovereign', 'fiend-sovereign', 'frostcoil', 'frostblade-fiend'],
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
