import { create } from 'zustand'
import { computeDerivedStats } from '../stats/derivedStats'
import { useCharacterStore } from '../stats/useCharacterStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { computeEquipmentBonus } from '../items/equipmentBonus'
import { useEquipmentStore } from '../items/useEquipmentStore'
import { useInventoryStore } from '../items/useInventoryStore'
import { useItemTemplatesStore } from '../items/useItemTemplatesStore'
import { ENEMY_TYPES, type EnemyTypeId } from '../zones/zoneData'
import { useCombatStore, type CombatLogEntry } from './useCombatStore'
import {
  MONSTER_ATTACK_INTERVAL_MS,
  applyDamageReduction,
  monsterAttackDamage,
  playerDefenseMultiplierForLevelDiff,
  resolvePhysicalDamage,
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
// this tick loop only drives HP bars/log/pacing (attack-back, respawn
// countdown), corrected on every resolveRowCombat response (see
// resolveRowCombat.ts's reconciliation, which overwrites `slots` from the
// server's confirmed state).
//
// Row slots are ability/passive-only targets — NO basic auto-attack (2026-
// 08-17, requested by the user: with 6 slots to auto-target across, plain
// auto-attack alone was clearing Row 1 fast enough that Multi-Shot barely
// mattered). The normal single-target Zone & Monster fight keeps running in
// the background exactly as it always has — toggling a row slot on was
// never actually wired to pause it (the original Phase 1 plan's "pause
// single-target on row toggle" mode-handoff never got implemented), which
// turned out to be exactly the behavior wanted here: two independent damage
// sources, auto-attack on the normal target, Multi-Shot (and future
// abilities/passives) on row slots.
//
// Player HP/knockout is NOT duplicated here — see useCombatStore.ts's
// isKnockedOutAt/applyIncomingDamage, added specifically so both combat
// modes share one HP pool (the same character, same HP bar).

export const ROW_SLOT_COUNT = 12
// Aligned with MULTI_SHOT_COOLDOWN_MS (2026-08-17, requested by the user) —
// mirrors resolve-row-combat/index.ts's own ROW_RESPAWN_MS, must stay in sync.
export const ROW_RESPAWN_MS = 10_000
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

// One Multi-Shot target's real result, as reported by resolve-row-combat's
// response (see resolveRowCombat.ts) — used to drive a floating "-N"/"Miss"
// number over the right slot tile, same visual language CombatPage.tsx's
// own floatingNumbers already uses for single-target combat. Multi-Shot's
// damage is real server RNG (min/max rolled, not deterministic expected
// value — see resolve-row-combat/index.ts's rollDamageInRange comment), so
// unlike the rest of this store's tick loop, these are never predicted
// client-side — only ever shown once the server's response actually arrives.
export interface RowFloatingHit {
  id: string
  slotIndex: number
  timestamp: number
  hit: boolean
  damage: number
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
  // Recent Multi-Shot results across all slots — RowSlotTile filters this
  // down to its own slotIndex + a short recency window to render its own
  // floating numbers. Capped, not pruned by age here (consumers do their
  // own recency filtering against Date.now()).
  multiShotHits: RowFloatingHit[]
  setUnlocked: (row1Unlocked: boolean, row2Unlocked: boolean) => void
  // Overwrites local slot HP/enabled/monster/dead-at from the server's
  // confirmed state (called after every resolveRowCombat response) — never
  // additive, same "server response reconciles local state" convention
  // every other store in this game follows.
  applyServerSlots: (serverSlots: ServerRowSlot[]) => void
  applyServerMultiShotReadyAt: (readyAtIso: string) => void
  applyMultiShotHits: (hits: { slotIndex: number; hit: boolean; damage: number }[]) => void
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
  multiShotHits: [],

  setUnlocked: (row1Unlocked, row2Unlocked) => set({ row1Unlocked, row2Unlocked }),

  applyMultiShotHits: (hits) => {
    if (hits.length === 0) return
    const now = Date.now()
    set((state) => ({
      multiShotHits: [
        ...state.multiShotHits,
        ...hits.map((h) => ({
          id: `${now}-${h.slotIndex}-${Math.random().toString(36).slice(2, 8)}`,
          slotIndex: h.slotIndex,
          timestamp: now,
          hit: h.hit,
          damage: h.damage,
        })),
      ].slice(-40),
    }))
  },

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

    const { attributes } = useCharacterStore.getState()
    const characterLevel = useProgressionStore.getState().level
    const equipmentBonus = computeEquipmentBonus(
      useEquipmentStore.getState().equippedIds,
      useInventoryStore.getState().items,
      useItemTemplatesStore.getState().templates,
    )
    const derived = computeDerivedStats(attributes, equipmentBonus)

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
