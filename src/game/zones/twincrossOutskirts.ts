import type { TileCoord } from '../utils/grid'

// Placeholder zone name — our renamed take on the original starting zone. Final
// zone naming across all 7 zones is unresolved per CLAUDE.md.
export const ZONE_NAME = 'Twincross Outskirts'

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

export interface EnemySpawnDef {
  id: string
  typeId: EnemyTypeId
  tile: TileCoord
}

// Fixed spawn points scattered around the hero's starting tile (50, 50) — all
// within the default visible radius so the roster is visible without moving first.
export const ENEMY_SPAWNS: EnemySpawnDef[] = [
  { id: 'mudrat-1', typeId: 'mudrat', tile: { x: 53, y: 50 } },
  { id: 'mudrat-2', typeId: 'mudrat', tile: { x: 47, y: 53 } },
  { id: 'brushfowl-1', typeId: 'brushfowl', tile: { x: 55, y: 47 } },
  { id: 'brushfowl-2', typeId: 'brushfowl', tile: { x: 45, y: 49 } },
  { id: 'fernvale-dove-1', typeId: 'fernvale-dove', tile: { x: 50, y: 56 } },
]
