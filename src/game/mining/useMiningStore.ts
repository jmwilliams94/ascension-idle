import { create } from 'zustand'
import { resolvePhysicalDamage, rollDamageInRange } from '../combat/combatResolver'
import { PICKAXE_QUALITY_MULTIPLIERS, computeCompositionBonusStats } from '../items/equipmentBonus'
import { MINING_ATTACK_INTERVAL_MS, MINING_RESPAWN_GAP_MS } from './miningResolver'
import { nodeForMine, type MineId } from './mineData'
import { getEquippedPickaxe } from './equippedPickaxe'

// Live tick-gated store, sibling to useCombatStore.ts — much simpler, since a
// mining node has no dodge/hit-chance/attack-back/player-HP concept. Only
// predicts/displays the local "feel" (HP bar, damage numbers, respawn
// countdown); resolveMining.ts's periodic reconcile is the only thing that
// actually grants Ore/Gems, same "fast local loop + slow authoritative
// reconcile" split combat uses.

export type MiningLogKind = 'engage' | 'damage' | 'kill' | 'ore' | 'gem' | 'inventory-full' | 'unequipped'

export interface MiningLogEntry {
  id: string
  kind: MiningLogKind
  message: string
  timestamp: number
  amount?: number
}

const LOG_CAP = 40

function appendLog(log: MiningLogEntry[], entry: Omit<MiningLogEntry, 'id' | 'timestamp'>): MiningLogEntry[] {
  const full: MiningLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  }
  return [...log, full].slice(-LOG_CAP)
}

interface MiningState {
  isMining: boolean
  // The mine actually being actively mined (mirrors useCombatStore's
  // monsterTypeId) — separate from useMineStore's currentMineId, which is
  // just the staged picker selection.
  activeMineId: MineId | null
  nodeInstanceKey: number
  currentHp: number
  maxHp: number
  respawnReadyAt: number
  log: MiningLogEntry[]
  lastAttackAt: number
  start: (mineId: MineId) => void
  stop: () => void
  clear: () => void
  runTick: (nowMs: number) => void
  stopForInventoryFull: () => void
  logGrant: (message: string, kind: 'ore' | 'gem') => void
}

export const useMiningStore = create<MiningState>((set, get) => ({
  isMining: false,
  activeMineId: null,
  nodeInstanceKey: 0,
  currentHp: 0,
  maxHp: 0,
  respawnReadyAt: 0,
  log: [],
  lastAttackAt: 0,

  start: (mineId) => {
    const node = nodeForMine(mineId)
    set((state) => ({
      isMining: true,
      activeMineId: mineId,
      nodeInstanceKey: state.nodeInstanceKey + 1,
      currentHp: node.maxHp,
      maxHp: node.maxHp,
      lastAttackAt: 0,
      respawnReadyAt: 0,
      log: appendLog(state.log, { kind: 'engage', message: `You start mining the ${node.displayName}.` }),
    }))
  },

  stop: () => set({ isMining: false }),

  clear: () =>
    set({
      isMining: false,
      activeMineId: null,
      currentHp: 0,
      maxHp: 0,
      respawnReadyAt: 0,
    }),

  runTick: (nowMs) => {
    const state = get()
    if (!state.isMining || !state.activeMineId) return

    const node = nodeForMine(state.activeMineId)

    if (state.respawnReadyAt > 0) {
      if (nowMs < state.respawnReadyAt) return
      set((s) => ({
        nodeInstanceKey: s.nodeInstanceKey + 1,
        currentHp: node.maxHp,
        maxHp: node.maxHp,
        respawnReadyAt: 0,
        lastAttackAt: nowMs,
      }))
      return
    }

    if (nowMs - state.lastAttackAt < MINING_ATTACK_INTERVAL_MS) return

    // Pickaxe is a normal Main Hand weapon now (requested by the user) — if
    // the weapon slot no longer holds a pickaxe-family item (unequipped,
    // swapped back to a real combat weapon, or swapped to anything else),
    // mining stops right here instead of computing damage. This replaces the
    // old dedicated "unequip stops mining" hook with a general per-tick
    // check, so it also covers e.g. re-equipping the real weapon directly.
    const pickaxe = getEquippedPickaxe()
    if (!pickaxe) {
      set((s) => ({
        isMining: false,
        log: appendLog(s.log, { kind: 'unequipped', message: 'Pickaxe unequipped — mining stopped.' }),
      }))
      return
    }

    const rawAttack = pickaxe.template.base_stats.physical_attack ?? 0
    const scaledAttack = Math.round(rawAttack * (PICKAXE_QUALITY_MULTIPLIERS[pickaxe.item.quality_tier] ?? 1))
    const compositionBonus =
      computeCompositionBonusStats(pickaxe.template.base_stats, pickaxe.template.slot_type, pickaxe.item.composition_level).physical_attack ?? 0
    const attackMidpoint = scaledAttack + compositionBonus
    const damage = resolvePhysicalDamage(rollDamageInRange(attackMidpoint), node.defense)
    const nextHp = Math.max(0, state.currentHp - damage)

    set((s) => ({
      lastAttackAt: nowMs,
      currentHp: nextHp,
      log: appendLog(s.log, { kind: 'damage', message: `You strike the ${node.displayName} for ${damage}.`, amount: damage }),
    }))

    if (nextHp <= 0) {
      set((s) => ({
        currentHp: 0,
        maxHp: 0,
        respawnReadyAt: nowMs + MINING_RESPAWN_GAP_MS,
        log: appendLog(s.log, { kind: 'kill', message: `The ${node.displayName} is depleted.` }),
      }))
    }
  },

  stopForInventoryFull: () =>
    set((s) => ({
      isMining: false,
      log: appendLog(s.log, { kind: 'inventory-full', message: 'Inventory full — mining stopped.' }),
    })),

  logGrant: (message, kind) => set((s) => ({ log: appendLog(s.log, { kind, message }) })),
}))
