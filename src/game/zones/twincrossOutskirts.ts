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

// Zone layout convention: the map is quartered by enemy type — one type per quadrant
// around the hero's starting tile (50, 50), which sits exactly on the corner where
// all four quadrants meet. With 3 types we use 3 of the 4 quadrants (NW/NE/SW); SE is
// intentionally left empty for now (a 4th type, or repurposed later — see the
// instanced-farming-map idea in CLAUDE.md's Zones section).
export const ENEMY_SPAWNS: EnemySpawnDef[] = [
  // NW quadrant (x < 50, y < 50) — Mudrat
  { id: 'mudrat-1', typeId: 'mudrat', tile: { x: 47, y: 47 } },
  { id: 'mudrat-2', typeId: 'mudrat', tile: { x: 44, y: 45 } },
  { id: 'mudrat-3', typeId: 'mudrat', tile: { x: 46, y: 42 } },

  // NE quadrant (x >= 50, y < 50) — Brushfowl
  { id: 'brushfowl-1', typeId: 'brushfowl', tile: { x: 53, y: 47 } },
  { id: 'brushfowl-2', typeId: 'brushfowl', tile: { x: 56, y: 45 } },
  { id: 'brushfowl-3', typeId: 'brushfowl', tile: { x: 54, y: 42 } },

  // SW quadrant (x < 50, y >= 50) — Fernvale Dove
  { id: 'fernvale-dove-1', typeId: 'fernvale-dove', tile: { x: 47, y: 53 } },
  { id: 'fernvale-dove-2', typeId: 'fernvale-dove', tile: { x: 44, y: 56 } },
  { id: 'fernvale-dove-3', typeId: 'fernvale-dove', tile: { x: 46, y: 58 } },
]
