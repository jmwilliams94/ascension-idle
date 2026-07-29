import { create } from 'zustand'
import { computeDerivedStats } from '../stats/derivedStats'
import { useCharacterStore } from '../stats/useCharacterStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { computeEquipmentBonus } from '../items/equipmentBonus'
import { useEquipmentStore } from '../items/useEquipmentStore'
import { useArrowStore } from '../items/useArrowStore'
import { useInventoryStore } from '../items/useInventoryStore'
import { useItemTemplatesStore } from '../items/useItemTemplatesStore'
import { useOutOfArrowsWarningStore } from '../items/useOutOfArrowsWarningStore'
import { ENEMY_TYPES, type EnemyTypeId } from '../zones/zoneData'
import { killRewards, rollIsRare, spawnMonsterHp } from './combatResolver'

export type CombatLogKind = 'engage' | 'damage' | 'kill' | 'rare-kill' | 'item' | 'out-of-arrows'

export interface CombatLogEntry {
  id: string
  kind: CombatLogKind
  message: string
  timestamp: number
  // Present on 'damage' entries only — lets the UI drive floating damage numbers
  // without parsing the message text.
  amount?: number
}

// Keeps the log from growing unbounded across a long idle session — only the most
// recent entries matter for the UI, unlike gold/EXP which are cumulative totals
// tracked separately by useProgressionStore.
const LOG_CAP = 40

function appendLog(log: CombatLogEntry[], entry: Omit<CombatLogEntry, 'id' | 'timestamp'>): CombatLogEntry[] {
  const full: CombatLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  }
  return [...log, full].slice(-LOG_CAP)
}

interface CombatState {
  isFighting: boolean
  monsterTypeId: EnemyTypeId | null
  // Bumped on every spawn/respawn so the HP bar/portrait can key off it and remount/
  // reset its transition cleanly rather than animating from the previous monster's HP.
  monsterInstanceKey: number
  currentHp: number
  maxHp: number
  isRareInstance: boolean
  log: CombatLogEntry[]
  lastAttackAt: number
  // Selects a monster and begins fighting it. Safe to call again with the same or a
  // different monster — always starts a fresh instance (no "resume mid-HP").
  start: (monsterTypeId: EnemyTypeId) => void
  stop: () => void
  // Fully resets the active-fight state (unlike stop(), which only pauses) —
  // called when switching zones, since a monster from one zone shouldn't still
  // show as the "paused" fight (with a Resume button) once you're looking at a
  // different zone's roster. Keeps the log for continuity.
  clear: () => void
  // Driven by CombatEngine's interval — a no-op if not currently fighting or if the
  // attack-speed cooldown hasn't elapsed yet.
  runTick: (nowMs: number) => void
}

export const useCombatStore = create<CombatState>((set, get) => ({
  isFighting: false,
  monsterTypeId: null,
  monsterInstanceKey: 0,
  currentHp: 0,
  maxHp: 0,
  isRareInstance: false,
  log: [],
  lastAttackAt: 0,

  start: (monsterTypeId) => {
    const type = ENEMY_TYPES[monsterTypeId]
    const isRare = rollIsRare()
    const hp = spawnMonsterHp(type, isRare)

    set((state) => ({
      isFighting: true,
      monsterTypeId,
      monsterInstanceKey: state.monsterInstanceKey + 1,
      currentHp: hp,
      maxHp: hp,
      isRareInstance: isRare,
      lastAttackAt: 0,
      log: appendLog(state.log, {
        kind: 'engage',
        message: isRare ? `A rare ${type.displayName} appears!` : `You engage a ${type.displayName}.`,
      }),
    }))
  },

  stop: () => set({ isFighting: false }),

  clear: () =>
    set({
      isFighting: false,
      monsterTypeId: null,
      currentHp: 0,
      maxHp: 0,
      isRareInstance: false,
    }),

  runTick: (nowMs) => {
    const state = get()

    if (!state.isFighting || !state.monsterTypeId) {
      return
    }

    const type = ENEMY_TYPES[state.monsterTypeId]
    const { selectedClassId, attributes } = useCharacterStore.getState()
    const equipmentBonus = computeEquipmentBonus(
      useEquipmentStore.getState().equippedItemId,
      useInventoryStore.getState().items,
      useItemTemplatesStore.getState().templates,
    )
    const derived = computeDerivedStats(attributes, equipmentBonus)
    const attackIntervalMs = 1000 / derived.attackSpeed

    // On-cooldown ticks are simply dropped, not queued — same behavior as the old
    // isometric scene's attack-speed gating.
    if (nowMs - state.lastAttackAt < attackIntervalMs) {
      return
    }

    // Hunter must have an equipped arrow stack with remaining count to attack at
    // all. lastAttackAt still advances on a blocked attempt so it respects the
    // cooldown instead of re-checking (and re-flashing the warning) every tick.
    if (selectedClassId === 'hunter' && !useArrowStore.getState().consumeArrow()) {
      useOutOfArrowsWarningStore.getState().trigger()
      set((s) => ({
        lastAttackAt: nowMs,
        log: appendLog(s.log, { kind: 'out-of-arrows', message: 'Out of arrows!' }),
      }))
      return
    }

    // PLACEHOLDER damage formula, unchanged from the old attemptAttack(): raw
    // Physical Attack applied directly, no mitigation. Wuxia's Spirit-based attack
    // still deals 0 here — a pre-existing gap, not something this pivot introduces.
    const damage = derived.physicalAttack
    const nextHp = Math.max(0, state.currentHp - damage)

    set((s) => ({
      lastAttackAt: nowMs,
      currentHp: nextHp,
      log: appendLog(s.log, { kind: 'damage', message: `You hit ${type.displayName} for ${damage}.`, amount: damage }),
    }))

    if (nextHp <= 0) {
      const { gold, exp } = killRewards(type, state.isRareInstance)
      useProgressionStore.getState().addRewards(gold, exp)

      set((s) => ({
        log: appendLog(s.log, {
          kind: state.isRareInstance ? 'rare-kill' : 'kill',
          message: state.isRareInstance
            ? `Rare ${type.displayName} defeated! +${gold} Gold, +${exp} EXP`
            : `${type.displayName} defeated! +${gold} Gold, +${exp} EXP`,
        }),
      }))

      // Loot grants instantly on kill again (reverting the ground-pickup deferred
      // grant) — the 10% roll/odds are unchanged, only the delivery timing reverts.
      const drop = useInventoryStore.getState().rollItemDrop()
      if (drop) {
        void useInventoryStore.getState().grantItemDrop(drop.template, true).then((granted) => {
          if (granted) {
            useCombatStore.setState((s) => ({
              log: appendLog(s.log, { kind: 'item', message: `You found: ${granted.template.name}` }),
            }))
          }
        })
      }

      // Respawn immediately — no fixed respawn timer like the old isometric scene's
      // killEnemy(), since there's no spatial spawn point to wait for anymore.
      const nextIsRare = rollIsRare()
      const nextHpValue = spawnMonsterHp(type, nextIsRare)

      set((s) => ({
        monsterInstanceKey: s.monsterInstanceKey + 1,
        currentHp: nextHpValue,
        maxHp: nextHpValue,
        isRareInstance: nextIsRare,
        log: appendLog(
          s.log,
          nextIsRare
            ? { kind: 'engage', message: `A rare ${type.displayName} appears!` }
            : { kind: 'engage', message: `A new ${type.displayName} appears.` },
        ),
      }))
    }
  },
}))
