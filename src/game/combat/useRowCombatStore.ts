import { create } from 'zustand'
import { computeDerivedStats } from '../stats/derivedStats'
import { useCharacterStore } from '../stats/useCharacterStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { computeEquipmentBonus } from '../items/equipmentBonus'
import { useEquipmentStore } from '../items/useEquipmentStore'
import { useInventoryStore } from '../items/useInventoryStore'
import { useItemTemplatesStore } from '../items/useItemTemplatesStore'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'
import { getActiveGoldDonationEvent, useGoldDonationStore } from '../goldDonation/useGoldDonationStore'
import { ENEMY_TYPES, zoneIdForMonster, type EnemyTypeId } from '../zones/zoneData'
import { useCombatStore, type CombatLogEntry } from './useCombatStore'
import {
  MONSTER_ATTACK_INTERVAL_MS,
  applyDamageReduction,
  expectedRewardPerAttack,
  monsterAttackDamage,
  monsterDefense,
  monsterDodge,
  playerDefenseMultiplierForLevelDiff,
  resolvePhysicalDamage,
  rollAttackLands,
  rollDamageInRange,
  rollIsHit,
  rollIsRare,
  spawnMonsterHp,
} from './combatResolver'

// Row Combat, Phase 1 — see notes/ for the design plan. A live-only, 12-slot
// (2 rows of 6) sibling to useCombatStore.ts: each slot independently
// toggled on/off, spawning whatever ENEMY_TYPES[id] is currently selected in
// the normal zone/monster picker at toggle-on time — not a fixed roster, so
// different slots can end up hosting different monster types. This store is
// PREDICTION-ONLY, exactly like useCombatStore.runTick's own visual layer —
// resolve-row-combat (the Edge Function) is the sole source of real rewards;
// this tick loop only drives HP bars/log/pacing and a smooth
// addPredictedRewards estimate, corrected on every resolveRowCombat response
// (see resolveRowCombat.ts's reconciliation, which overwrites `slots` from
// the server's confirmed state).
//
// Player HP/knockout is NOT duplicated here — see useCombatStore.ts's
// isKnockedOutAt/applyIncomingDamage, added specifically so both combat
// modes share one HP pool (the same character, same HP bar), consistent
// with the "row mode pauses, doesn't replace, single-target" mode handoff.

export const ROW_SLOT_COUNT = 12
export const ROW_RESPAWN_MS = 15_000
// Placeholder/tunable, matches resolve-row-combat/index.ts's own copy —
// must stay in sync.
export const MULTI_SHOT_COOLDOWN_MS = 10_000

export interface RowSlotState {
  enabled: boolean
  monsterTypeId: EnemyTypeId | null
  // Bumped whenever a slot's monster instance changes (fresh toggle-on or a
  // respawn) so the HP bar can remount cleanly — mirrors
  // CombatState.monsterInstanceKey.
  monsterInstanceKey: number
  currentHp: number
  maxHp: number
  isRareInstance: boolean
  // 0 = alive. Nonzero = the nowMs timestamp this slot's monster died —
  // drives the local "respawning in Ns" countdown display and the local
  // respawn timer below.
  deadAt: number
  // Independent per-slot attack-back cadence (MONSTER_ATTACK_INTERVAL_MS) —
  // each enabled+alive slot attacks the shared player HP pool on its own
  // clock, not synced to the others or to the player's own attack speed.
  lastMonsterAttackAt: number
}

function emptySlot(): RowSlotState {
  return {
    enabled: false,
    monsterTypeId: null,
    monsterInstanceKey: 0,
    currentHp: 0,
    maxHp: 0,
    isRareInstance: false,
    deadAt: 0,
    lastMonsterAttackAt: 0,
  }
}

function emptySlots(): RowSlotState[] {
  return Array.from({ length: ROW_SLOT_COUNT }, emptySlot)
}

// Shape resolve-row-combat's `rowSlots` response field uses (see
// resolve-row-combat/index.ts's serializeRowSlots) — snake_case, dead_at as
// an ISO string or null.
export interface ServerRowSlot {
  enabled: boolean
  monster_id: string | null
  current_hp: number
  max_hp: number
  is_rare: boolean
  dead_at: string | null
}

interface RowCombatState {
  slots: RowSlotState[]
  row1Unlocked: boolean
  row2Unlocked: boolean
  // Client-predicted cooldown display only — the server is authoritative on
  // whether a press actually lands (see resolveRowCombat's
  // multiShotOnCooldown handling).
  multiShotReadyAt: number
  log: CombatLogEntry[]
  lastAttackAt: number
  setUnlocked: (row1Unlocked: boolean, row2Unlocked: boolean) => void
  // Overwrites local slot HP/enabled/monster/dead-at from the server's
  // confirmed state (called after every resolveRowCombat response) — never
  // additive, same "server response reconciles local state" convention
  // every other store in this game follows.
  applyServerSlots: (serverSlots: ServerRowSlot[]) => void
  applyServerMultiShotReadyAt: (readyAtIso: string) => void
  // Local-only optimistic clear for a slot the player just toggled off —
  // avoids a one-tick flash of stale HP before the next reconcile lands.
  clearSlotLocally: (slotIndex: number) => void
  runTick: (nowMs: number) => void
  fireMultiShotOptimistic: (nowMs: number) => void
  stopAllForInventoryFull: () => void
}

function appendLog(log: CombatLogEntry[], entry: Omit<CombatLogEntry, 'id' | 'timestamp'>): CombatLogEntry[] {
  const full: CombatLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  }
  return [...log, full].slice(-40)
}

export const useRowCombatStore = create<RowCombatState>((set, get) => ({
  slots: emptySlots(),
  row1Unlocked: false,
  row2Unlocked: false,
  multiShotReadyAt: 0,
  log: [],
  lastAttackAt: 0,

  setUnlocked: (row1Unlocked, row2Unlocked) => set({ row1Unlocked, row2Unlocked }),

  applyServerSlots: (serverSlots) => {
    set((state) => ({
      slots: Array.from({ length: ROW_SLOT_COUNT }, (_, i) => {
        const server = serverSlots[i]
        const prev = state.slots[i] ?? emptySlot()
        if (!server || !server.enabled) return emptySlot()
        const deadAt = server.dead_at ? new Date(server.dead_at).getTime() : 0
        // A fresh instance (different monster, or was dead and is now alive
        // again) bumps monsterInstanceKey so the HP bar remounts cleanly.
        const isFreshInstance = prev.monsterTypeId !== server.monster_id || (prev.deadAt !== 0 && deadAt === 0)
        return {
          enabled: true,
          monsterTypeId: server.monster_id as EnemyTypeId,
          monsterInstanceKey: isFreshInstance ? prev.monsterInstanceKey + 1 : prev.monsterInstanceKey,
          currentHp: server.current_hp,
          maxHp: server.max_hp,
          isRareInstance: server.is_rare,
          deadAt,
          lastMonsterAttackAt: isFreshInstance ? 0 : prev.lastMonsterAttackAt,
        }
      }),
    }))
  },

  applyServerMultiShotReadyAt: (readyAtIso) => set({ multiShotReadyAt: new Date(readyAtIso).getTime() }),

  clearSlotLocally: (slotIndex) =>
    set((state) => ({
      slots: state.slots.map((s, i) => (i === slotIndex ? emptySlot() : s)),
    })),

  runTick: (nowMs) => {
    const state = get()
    if (!state.slots.some((s) => s.enabled)) return

    // Shared knockout gate — while incapacitated, neither the row's own
    // attack nor any slot's attack-back acts this tick, mirroring
    // useCombatStore.runTick's own reviveAt handling exactly (see
    // isKnockedOutAt's comment).
    if (useCombatStore.getState().isKnockedOutAt(nowMs)) return

    const { selectedClassId, attributes } = useCharacterStore.getState()
    const characterLevel = useProgressionStore.getState().level
    const equipmentBonus = computeEquipmentBonus(
      useEquipmentStore.getState().equippedIds,
      useInventoryStore.getState().items,
      useItemTemplatesStore.getState().templates,
    )
    const derived = computeDerivedStats(attributes, equipmentBonus)
    const attackIntervalMs = 1000 / derived.attackSpeed

    const { accountZoneAttackBonusPct } = usePlayerRecordStore.getState()
    const activeGoldDonationEvent = getActiveGoldDonationEvent(useGoldDonationStore.getState().pool, nowMs)
    const eventExpMultiplier = activeGoldDonationEvent?.category === 'exp' ? activeGoldDonationEvent.multiplier : 1

    // Per-zone attack midpoint, memoized — each slot's own monster may
    // belong to a different zone than whatever's currently selected, since
    // a slot locks in its monster at its own toggle-on time (mirrors
    // resolve-row-combat's own attackMidpointForZone).
    const attackMidpointCache = new Map<string, number>()
    function attackMidpointForZone(zoneId: string | null): number {
      const key = zoneId ?? ''
      const cached = attackMidpointCache.get(key)
      if (cached !== undefined) return cached
      const accountAttackBonusPct = accountZoneAttackBonusPct[key] ?? 0
      const physicalSubtotal = derived.physicalAttack * (1 + accountAttackBonusPct / 100) + derived.compositionPhysicalAttackBonus
      const magicSubtotal = derived.magicAttack * (1 + accountAttackBonusPct / 100) + derived.compositionMagicAttackBonus
      const value = physicalSubtotal * (1 + derived.drakeBonusPct / 100) + magicSubtotal * (1 + derived.emberBonusPct / 100)
      attackMidpointCache.set(key, value)
      return value
    }

    const maxPlayerHp = derived.hp
    const effectivePlayerDefenseForType = (monsterLevel: number) =>
      Math.round(derived.physicalDefense * playerDefenseMultiplierForLevelDiff(characterLevel, monsterLevel))

    const slots = state.slots
    let anyChanged = false
    const nextSlots = slots.map((s) => ({ ...s }))

    // Per-slot monster attack-back — client-only, mirrors runTick's own
    // block, applied against the SHARED player HP pool via
    // useCombatStore.applyIncomingDamage. Independent cadence per slot.
    for (let i = 0; i < nextSlots.length; i += 1) {
      const slot = nextSlots[i]
      if (!slot.enabled || !slot.monsterTypeId || slot.currentHp <= 0) continue
      if (nowMs - slot.lastMonsterAttackAt < MONSTER_ATTACK_INTERVAL_MS) continue
      const type = ENEMY_TYPES[slot.monsterTypeId]
      slot.lastMonsterAttackAt = nowMs
      anyChanged = true
      if (rollIsHit(derived.dodge)) {
        const effectiveDefense = effectivePlayerDefenseForType(type.level)
        const damage = applyDamageReduction(
          resolvePhysicalDamage(monsterAttackDamage(type), effectiveDefense),
          derived.damageReductionPct,
        )
        useCombatStore.getState().applyIncomingDamage(damage, nowMs, type.displayName)
      }
    }

    // Local 15s respawn timer per dead slot.
    for (let i = 0; i < nextSlots.length; i += 1) {
      const slot = nextSlots[i]
      if (slot.enabled && slot.deadAt !== 0 && nowMs - slot.deadAt >= ROW_RESPAWN_MS && slot.monsterTypeId) {
        const type = ENEMY_TYPES[slot.monsterTypeId]
        const isRare = rollIsRare()
        const hp = spawnMonsterHp(type, isRare)
        nextSlots[i] = {
          ...slot,
          currentHp: hp,
          maxHp: hp,
          isRareInstance: isRare,
          deadAt: 0,
          monsterInstanceKey: slot.monsterInstanceKey + 1,
        }
        anyChanged = true
      }
    }

    // Player's own basic attack — first enabled+alive slot, same "no manual
    // targeting" auto-attack shape as single-target combat.
    let logEntries: CombatLogEntry[] = []
    if (nowMs - state.lastAttackAt >= attackIntervalMs) {
      const targetIndex = nextSlots.findIndex((s) => s.enabled && s.currentHp > 0)
      if (targetIndex >= 0 && !(selectedClassId === 'hunter' && !useEquipmentStore.getState().equippedIds.quiver)) {
        const slot = nextSlots[targetIndex]
        const type = ENEMY_TYPES[slot.monsterTypeId!]
        const attackMidpoint = attackMidpointForZone(zoneIdForMonster(slot.monsterTypeId!))

        const perAttack = expectedRewardPerAttack(attackMidpoint, derived.dexterity, type, characterLevel, derived.irisBonusPct, eventExpMultiplier)
        useProgressionStore.getState().addPredictedRewards(perAttack.gold, perAttack.exp)

        if (rollAttackLands(derived.dexterity, monsterDodge(type))) {
          const damage = resolvePhysicalDamage(rollDamageInRange(attackMidpoint), monsterDefense(type, characterLevel))
          const nextHp = Math.max(0, slot.currentHp - damage)
          nextSlots[targetIndex] = { ...slot, currentHp: nextHp }
          logEntries = appendLog(logEntries, { kind: 'damage', message: `You hit ${type.displayName} for ${damage}.`, amount: damage })
          if (nextHp <= 0) {
            nextSlots[targetIndex] = { ...nextSlots[targetIndex], deadAt: nowMs }
            logEntries = appendLog(logEntries, { kind: 'kill', message: `${type.displayName} defeated!` })
          }
        } else {
          logEntries = appendLog(logEntries, { kind: 'miss', message: `Your attack misses ${type.displayName}!` })
        }
      }
      anyChanged = true
      set((s) => ({ lastAttackAt: nowMs, log: logEntries.length > 0 ? [...s.log, ...logEntries].slice(-40) : s.log }))
    }

    // Lazy player-HP init, same as runTick — only writes when something's
    // actually uninitialized, since useCombatStore already owns this state.
    if (useCombatStore.getState().maxPlayerHp <= 0) {
      useCombatStore.setState({ currentPlayerHp: maxPlayerHp, maxPlayerHp })
    }

    if (anyChanged) {
      set({ slots: nextSlots })
    }
  },

  fireMultiShotOptimistic: (nowMs) => {
    // Purely cosmetic — bumps the local cooldown display immediately on
    // click so the button visibly responds; the real cooldown/whether it
    // actually landed is confirmed by the next resolveRowCombat response
    // (see resolveRowCombat.ts's multiShotOnCooldown/multiShotReadyAt
    // handling, which corrects this if the press was rejected server-side).
    set({ multiShotReadyAt: nowMs + MULTI_SHOT_COOLDOWN_MS })
  },

  stopAllForInventoryFull: () =>
    set((state) => ({
      slots: emptySlots(),
      log: appendLog(state.log, {
        kind: 'inventory-full',
        message: 'Inventory is full — row combat stopped. Clear some space to keep fighting.',
      }),
    })),
}))
