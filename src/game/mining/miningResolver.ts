import { resolvePhysicalDamage } from '../combat/combatResolver'
import type { MiningNodeDef } from './mineData'

// Pure math, sibling to combatResolver.ts — much simpler, since a mining
// node has no dodge/hit-chance/EXP/rare-blend concept. Predictive/display
// only: real grants happen server-side (resolve-mining Edge Function), same
// "fast local loop + slow authoritative reconcile" split combat uses.

export const MINING_ATTACK_INTERVAL_MS = 1000

// 10-second respawn timer on mining nodes, per the design spec.
export const MINING_RESPAWN_GAP_MS = 10_000

// Closed-form cycle-time model, mirroring resolve-combat's own
// dps -> timeToKillMs -> cycleTimeMs -> expectedKills chain, without the
// overkill-cap/rare-blend machinery (mining has no rare-node concept).
export function expectedMiningCycleTimeMs(attackMidpoint: number, node: MiningNodeDef): number {
  const expectedDamagePerHit = resolvePhysicalDamage(attackMidpoint, node.defense)
  const dps = expectedDamagePerHit / MINING_ATTACK_INTERVAL_MS
  const timeToKillMs = node.maxHp / dps
  return timeToKillMs + MINING_RESPAWN_GAP_MS
}
