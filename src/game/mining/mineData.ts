import type { GemTypeId } from '../items/gemCatalog'

// Client-side mirror of the mining_nodes table (server's own copy, same
// relationship enemy_types has to zoneData.ts's ENEMY_TYPES — regenerate
// this if these stats ever change). Unlike EnemyTypeDef/ZoneDef, a mining
// node has no incoming-damage/EXP fields — it's inanimate: no dodge, no
// attack-back, no player HP risk, no EXP reward.
//
// Exactly one node per mine for now (nodeId is singular, not an array) —
// room to expand to multiple nodes per mine later without reshaping MineDef.
export type MineId = 'windhollow' | 'cinderleaf' | 'stormvale' | 'sunscar-wastes'

export type MiningNodeId = 'iron-vein' | 'cinder-vein' | 'storm-vein' | 'sunscar-vein'

export interface MiningNodeDef {
  id: MiningNodeId
  displayName: string
  mineId: MineId
  maxHp: number
  defense: number
  // Which of the 4 currently-coded gem types (drake/ember/bastion/iris) can
  // drop at this node — the other 4 designed gem types (rage/orchid/kirin/
  // crescent) have no data-layer code yet.
  gemPool: GemTypeId[]
  portraitUrl?: string
}

export interface MineDef {
  id: MineId
  displayName: string
  nodeId: MiningNodeId
  locked: boolean
  backgroundUrl?: string
}

// PLACEHOLDER balance numbers (see supabase/migrations/20260926020000_add_mining_nodes.sql's
// header) — sized so early mines clear efficiently on early pickaxes and the
// 4th mine's node needs a heavily-composed Ascended pickaxe (not a bare one)
// to one-shot.
export const MINING_NODES: Record<MiningNodeId, MiningNodeDef> = {
  'iron-vein': {
    id: 'iron-vein',
    displayName: 'Iron Vein',
    mineId: 'windhollow',
    maxHp: 300,
    defense: 10,
    gemPool: ['iris', 'ember'],
  },
  'cinder-vein': {
    id: 'cinder-vein',
    displayName: 'Cinder Vein',
    mineId: 'cinderleaf',
    maxHp: 500,
    defense: 30,
    gemPool: ['ember', 'bastion'],
  },
  'storm-vein': {
    id: 'storm-vein',
    displayName: 'Storm Vein',
    mineId: 'stormvale',
    maxHp: 800,
    defense: 60,
    gemPool: ['drake', 'bastion'],
  },
  'sunscar-vein': {
    id: 'sunscar-vein',
    displayName: 'Sunscar Vein',
    mineId: 'sunscar-wastes',
    maxHp: 1200,
    defense: 100,
    gemPool: ['drake', 'ember', 'bastion', 'iris'],
  },
}

export const MINES: Record<MineId, MineDef> = {
  windhollow: { id: 'windhollow', displayName: 'Windhollow', nodeId: 'iron-vein', locked: false },
  cinderleaf: { id: 'cinderleaf', displayName: 'Cinderleaf', nodeId: 'cinder-vein', locked: false },
  stormvale: { id: 'stormvale', displayName: 'Stormvale', nodeId: 'storm-vein', locked: false },
  'sunscar-wastes': { id: 'sunscar-wastes', displayName: 'Sunscar Wastes', nodeId: 'sunscar-vein', locked: false },
}

export const MINE_ORDER: MineId[] = ['windhollow', 'cinderleaf', 'stormvale', 'sunscar-wastes']

export const DEFAULT_MINE_ID: MineId = 'windhollow'

// Every mine has exactly one node today — this is the one lookup site that
// knows that, so callers never index MINING_NODES with a MineId directly.
export function nodeForMine(mineId: MineId): MiningNodeDef {
  return MINING_NODES[MINES[mineId].nodeId]
}
