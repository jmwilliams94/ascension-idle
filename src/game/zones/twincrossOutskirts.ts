import type { ZoneId } from './useZoneStore'

// Placeholder zone name — our renamed take on the original starting zone. Final
// zone naming across all 7 zones is unresolved per CLAUDE.md.
export const ZONE_NAME = 'Twincross Outskirts'

// Stable id for this zone, distinct from the display name above — persisted on
// characters.current_zone going forward (see useZoneStore).
export const ZONE_ID: ZoneId = 'twincross-outskirts'

export type EnemyTypeId = 'mudrat' | 'brushfowl' | 'fernvale-dove'

export interface EnemyTypeDef {
  id: EnemyTypeId
  displayName: string
  // PLACEHOLDER flat stats — real zone economy (HP/gold/EXP scaling) is unresolved
  // per CLAUDE.md. Roughly scaled relative to each other, not tuned balance.
  maxHp: number
  goldReward: number
  expReward: number
  bodyColor: { top: number; right: number; left: number }
}

// Placeholder low-level roster, similar flavor to a typical starting-zone bird/rat
// lineup without copying any specific game's names directly.
export const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeDef> = {
  mudrat: {
    id: 'mudrat',
    displayName: 'Mudrat',
    maxHp: 25,
    goldReward: 3,
    expReward: 8,
    bodyColor: { top: 0xd6d3d1, right: 0xa8a29e, left: 0x78716c },
  },
  brushfowl: {
    id: 'brushfowl',
    displayName: 'Brushfowl',
    maxHp: 40,
    goldReward: 5,
    expReward: 15,
    bodyColor: { top: 0xfde68a, right: 0xf59e0b, left: 0xb45309 },
  },
  'fernvale-dove': {
    id: 'fernvale-dove',
    displayName: 'Fernvale Dove',
    maxHp: 55,
    goldReward: 7,
    expReward: 22,
    bodyColor: { top: 0xbbf7d0, right: 0x4ade80, left: 0x15803d },
  },
}

// Deliberate, stable roster order for the Combat page's monster picker (replaces
// deriving the roster from the old spawn-placement data via a Set/dedupe trick).
export const ZONE_MONSTER_ORDER: EnemyTypeId[] = ['mudrat', 'brushfowl', 'fernvale-dove']
