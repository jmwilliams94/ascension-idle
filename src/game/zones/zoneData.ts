// Zone/monster names are confirmed, real reference data (the user's own 1-for-1
// Conquer Online rename list — see memory) — NOT placeholders, unlike the
// earlier "Twincross Outskirts"/Mudrat-Brushfowl-Fernvale-Dove zone this file
// replaces (that zone was explicitly flavor-only, never meant to be final).
// HP/gold/EXP/color values ARE still placeholders (unresolved per CLAUDE.md) —
// only the names themselves are sourced.
export type ZoneId =
  | 'dual-town'
  | 'waterbird-fortress'
  | 'monkey-town'
  | 'barren-town'
  | 'pigeon-peninsula'
  | 'spooky-citadel'
  | 'looty-loop'
  | 'chilly-cavern'

export type EnemyTypeId =
  // Dual Town
  | 'peacock'
  | 'fancy-pigeon'
  | 'eagle'
  | 'spook'
  | 'boo-hoo'
  // Waterbird Fortress
  | 'feathered-noodle'
  | 'thief'
  | 'mouse-kin'
  | 'water-spirit'
  // Monkey Town
  | 'angry-chimp'
  | 'king-kong-jr'
  | 'static-monkey'
  | 'python-pal'

export interface EnemyTypeDef {
  id: EnemyTypeId
  displayName: string
  // PLACEHOLDER flat stats — real zone economy (HP/gold/EXP/attack scaling) is
  // unresolved per CLAUDE.md. Roughly scaled to increase zone-over-zone, not
  // tuned balance.
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
  // --- Dual Town ---
  peacock: { id: 'peacock', displayName: 'Peacock', maxHp: 25, goldReward: 3, expReward: 8, attackDamage: 4, color: 0x38bdf8 },
  'fancy-pigeon': {
    id: 'fancy-pigeon',
    displayName: 'Fancy Pigeon',
    maxHp: 30,
    goldReward: 4,
    expReward: 10,
    attackDamage: 5,
    color: 0xd6d3d1,
  },
  eagle: { id: 'eagle', displayName: 'Eagle', maxHp: 40, goldReward: 5, expReward: 13, attackDamage: 6, color: 0xb45309 },
  spook: { id: 'spook', displayName: 'Spook', maxHp: 35, goldReward: 4, expReward: 12, attackDamage: 5, color: 0xe2e8f0 },
  'boo-hoo': { id: 'boo-hoo', displayName: 'Boo-Hoo', maxHp: 45, goldReward: 6, expReward: 15, attackDamage: 7, color: 0x94a3b8 },

  // --- Waterbird Fortress ---
  'feathered-noodle': {
    id: 'feathered-noodle',
    displayName: 'Feathered Noodle',
    maxHp: 50,
    goldReward: 6,
    expReward: 16,
    attackDamage: 7,
    color: 0xa3e635,
  },
  thief: { id: 'thief', displayName: 'Thief', maxHp: 55, goldReward: 7, expReward: 18, attackDamage: 8, color: 0x4c1d95 },
  'mouse-kin': {
    id: 'mouse-kin',
    displayName: 'Mouse-kin',
    maxHp: 45,
    goldReward: 6,
    expReward: 15,
    attackDamage: 7,
    color: 0x78716c,
  },
  'water-spirit': {
    id: 'water-spirit',
    displayName: 'Water Spirit',
    maxHp: 65,
    goldReward: 8,
    expReward: 20,
    attackDamage: 9,
    color: 0x22d3ee,
  },

  // --- Monkey Town ---
  'angry-chimp': {
    id: 'angry-chimp',
    displayName: 'Angry Chimp',
    maxHp: 70,
    goldReward: 9,
    expReward: 22,
    attackDamage: 10,
    color: 0x92400e,
  },
  'king-kong-jr': {
    id: 'king-kong-jr',
    displayName: 'King Kong Jr.',
    maxHp: 90,
    goldReward: 12,
    expReward: 28,
    attackDamage: 13,
    color: 0x451a03,
  },
  'static-monkey': {
    id: 'static-monkey',
    displayName: 'Static Monkey',
    maxHp: 75,
    goldReward: 10,
    expReward: 24,
    attackDamage: 11,
    color: 0xfacc15,
  },
  'python-pal': {
    id: 'python-pal',
    displayName: 'Python Pal',
    maxHp: 80,
    goldReward: 10,
    expReward: 25,
    attackDamage: 11,
    color: 0x16a34a,
  },
}

export interface ZoneDef {
  id: ZoneId
  displayName: string
  // Empty for locked zones — no roster data has been provided for them yet.
  monsterOrder: EnemyTypeId[]
  // True until the zone's real monster roster is provided — shown as a
  // disabled/"coming soon" entry in the zone picker rather than being selectable.
  locked: boolean
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  'dual-town': {
    id: 'dual-town',
    displayName: 'Dual Town',
    monsterOrder: ['peacock', 'fancy-pigeon', 'eagle', 'spook', 'boo-hoo'],
    locked: false,
  },
  'waterbird-fortress': {
    id: 'waterbird-fortress',
    displayName: 'Waterbird Fortress',
    monsterOrder: ['feathered-noodle', 'thief', 'mouse-kin', 'water-spirit'],
    locked: false,
  },
  'monkey-town': {
    id: 'monkey-town',
    displayName: 'Monkey Town',
    monsterOrder: ['angry-chimp', 'king-kong-jr', 'static-monkey', 'python-pal'],
    locked: false,
  },
  'barren-town': { id: 'barren-town', displayName: 'Barren Town', monsterOrder: [], locked: true },
  'pigeon-peninsula': { id: 'pigeon-peninsula', displayName: 'Pigeon Peninsula', monsterOrder: [], locked: true },
  'spooky-citadel': { id: 'spooky-citadel', displayName: 'Spooky Citadel', monsterOrder: [], locked: true },
  'looty-loop': { id: 'looty-loop', displayName: 'Looty Loop', monsterOrder: [], locked: true },
  'chilly-cavern': { id: 'chilly-cavern', displayName: 'Chilly Cavern', monsterOrder: [], locked: true },
}

// Display/selection order in the zone picker — matches the user's reference list order.
export const ZONE_ORDER: ZoneId[] = [
  'dual-town',
  'waterbird-fortress',
  'monkey-town',
  'barren-town',
  'pigeon-peninsula',
  'spooky-citadel',
  'looty-loop',
  'chilly-cavern',
]

export const DEFAULT_ZONE_ID: ZoneId = 'dual-town'
