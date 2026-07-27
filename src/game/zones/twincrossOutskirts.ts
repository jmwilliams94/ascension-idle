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

// Generates an evenly-spaced grid of spawn points filling a quadrant, rather than
// hand-placing dozens of coordinates. Placeholder density/spacing, not tuned design.
function generateQuadrantSpawns(
  typeId: EnemyTypeId,
  idPrefix: string,
  xRange: [number, number],
  yRange: [number, number],
  spacing: number,
): EnemySpawnDef[] {
  const spawns: EnemySpawnDef[] = []
  let index = 1

  for (let x = xRange[0]; x <= xRange[1]; x += spacing) {
    for (let y = yRange[0]; y <= yRange[1]; y += spacing) {
      spawns.push({ id: `${idPrefix}-${index}`, typeId, tile: { x, y } })
      index += 1
    }
  }

  return spawns
}

const QUADRANT_SPACING = 11

// Zone layout convention: the map is quartered by enemy type — one type spread across
// each quadrant of the full 100x100 grid, around the hero's starting tile (50, 50),
// which sits exactly on the corner where all four quadrants meet. With 3 types we use
// 3 of the 4 quadrants (NW/NE/SW); SE is intentionally left empty for now (a 4th type,
// or repurposed later — see the instanced-farming-map idea in CLAUDE.md's Zones section).
export const ENEMY_SPAWNS: EnemySpawnDef[] = [
  // NW quadrant (x < 50, y < 50) — Mudrat
  ...generateQuadrantSpawns('mudrat', 'mudrat', [3, 47], [3, 47], QUADRANT_SPACING),

  // NE quadrant (x >= 50, y < 50) — Brushfowl
  ...generateQuadrantSpawns('brushfowl', 'brushfowl', [53, 97], [3, 47], QUADRANT_SPACING),

  // SW quadrant (x < 50, y >= 50) — Fernvale Dove
  ...generateQuadrantSpawns('fernvale-dove', 'fernvale-dove', [3, 47], [53, 97], QUADRANT_SPACING),
]
