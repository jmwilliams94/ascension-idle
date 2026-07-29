import type { Attributes } from '../stats/classes'
import { computeDerivedStats, type EquipmentBonus } from '../stats/derivedStats'
import { computeEquipmentBonus } from '../items/equipmentBonus'
import { useCharacterStore } from '../stats/useCharacterStore'
import { useEquipmentStore } from '../items/useEquipmentStore'
import { useArrowStore } from '../items/useArrowStore'
import { useInventoryStore } from '../items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../items/useItemTemplatesStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCharacterRecordStore } from '../../lib/useCharacterRecordStore'
import { useZoneStore } from '../zones/useZoneStore'
import { ENEMY_TYPES, type EnemyTypeId } from '../zones/zoneData'
import { killRewards, rollIsRare, spawnMonsterHp } from './combatResolver'

// Idle progress while away is capped at 2 hours — a simple, deliberately generous
// cap rather than a tuned economy decision (see CLAUDE.md).
const MAX_OFFLINE_MS = 2 * 60 * 60 * 1000

export interface OfflineProgressResult {
  elapsedMs: number
  attacks: number
  kills: number
  rareKills: number
  gold: number
  exp: number
  itemDrops: ItemTemplate[]
}

interface SimulateParams {
  monsterTypeId: EnemyTypeId
  lastActiveAt: string
  attributes: Attributes
  equipmentBonus: EquipmentBonus
  isHunter: boolean
  // Infinity for non-Hunter classes (no ammo gating at all).
  availableArrows: number
  now?: number
}

// Bounded simulation loop reusing combatResolver.ts so rare-monster odds/HP/
// reward scaling can never drift between live combat and this offline
// calculation. At most ~7,200 iterations at 1 attack/sec over 2h (more at
// higher attack speed) — a plain loop, no perf concern. Returns null when
// nothing would have happened (no time elapsed, or a Hunter with 0 arrows),
// so the caller knows not to show an empty "you gained nothing" summary.
//
// Known gap: this does not simulate monster attack-back / player HP (see
// useCombatStore's currentPlayerHp/monsterAttackDamage) — an offline character
// is effectively invulnerable for the simulated window. Live combat and this
// simulator are meant to share identical odds (that's the whole point of both
// calling into combatResolver.ts), so this is a disclosed inconsistency, not a
// deliberate design choice — revisit if/when player-damage-taken gets a real
// death/recovery design instead of the current knockout-and-full-heal placeholder.
export function simulateOfflineProgress(params: SimulateParams): OfflineProgressResult | null {
  const now = params.now ?? Date.now()
  const lastActiveMs = new Date(params.lastActiveAt).getTime()

  if (Number.isNaN(lastActiveMs)) {
    return null
  }

  const elapsedMs = Math.min(Math.max(now - lastActiveMs, 0), MAX_OFFLINE_MS)

  const derived = computeDerivedStats(params.attributes, params.equipmentBonus)
  const attackIntervalMs = 1000 / derived.attackSpeed
  let totalAttacks = Math.floor(elapsedMs / attackIntervalMs)

  if (params.isHunter) {
    totalAttacks = Math.min(totalAttacks, params.availableArrows)
  }

  if (totalAttacks <= 0) {
    return null
  }

  const type = ENEMY_TYPES[params.monsterTypeId]
  let isRare = rollIsRare()
  let hp = spawnMonsterHp(type, isRare)

  let kills = 0
  let rareKills = 0
  let gold = 0
  let exp = 0
  const itemDrops: ItemTemplate[] = []

  for (let i = 0; i < totalAttacks; i += 1) {
    hp -= derived.physicalAttack

    if (hp <= 0) {
      kills += 1
      if (isRare) {
        rareKills += 1
      }

      const rewards = killRewards(type, isRare)
      gold += rewards.gold
      exp += rewards.exp

      const drop = useInventoryStore.getState().rollItemDrop()
      if (drop) {
        itemDrops.push(drop.template)
      }

      isRare = rollIsRare()
      hp = spawnMonsterHp(type, isRare)
    }
  }

  return { elapsedMs, attacks: totalAttacks, kills, rareKills, gold, exp, itemDrops }
}

// Applies a simulated result through the exact same code paths a live kill
// would use: addRewards for the aggregate gold/EXP (handles multi-level
// rollups in one shot), grantItemDrop per rolled item with interactive=false
// (matches the documented "AFK sim silently wastes drops on a full inventory"
// behavior — no modal needed for that path), and a local arrow-count
// decrement for Hunter. Finishes with saveNow to refresh last_active_at
// immediately, closing the window so a quick reload can't double-count it.
async function applyOfflineProgress(characterId: string, result: OfflineProgressResult, isHunter: boolean): Promise<void> {
  useProgressionStore.getState().addRewards(result.gold, result.exp)

  for (const template of result.itemDrops) {
    await useInventoryStore.getState().grantItemDrop(template, false)
  }

  if (isHunter) {
    for (let i = 0; i < result.attacks; i += 1) {
      if (!useArrowStore.getState().consumeArrow()) {
        break
      }
    }
    await useArrowStore.getState().saveStackCounts(characterId)
  }

  await useCharacterRecordStore.getState().saveNow(characterId)
}

// Orchestrator called once from GameShell's load effect, after character/
// inventory/arrow loads resolve. Reads everything it needs from the stores
// itself so the call site only needs the character id. Returns the result for
// the summary modal, or null if there's nothing to show (no monster ever
// selected, missing last_active_at, or the simulation itself produced zero
// attacks).
export async function runOfflineProgressCheck(characterId: string): Promise<OfflineProgressResult | null> {
  const { selectedMonsterId } = useZoneStore.getState()
  const previousLastActiveAt = useCharacterRecordStore.getState().previousLastActiveAt

  if (!selectedMonsterId || !previousLastActiveAt) {
    return null
  }

  const { selectedClassId, attributes } = useCharacterStore.getState()
  const isHunter = selectedClassId === 'hunter'
  const equipmentBonus = computeEquipmentBonus(
    useEquipmentStore.getState().equippedItemId,
    useInventoryStore.getState().items,
    useItemTemplatesStore.getState().templates,
  )

  let availableArrows = Infinity
  if (isHunter) {
    const { stacks, equippedStackId } = useArrowStore.getState()
    const stack = equippedStackId ? stacks.find((entry) => entry.id === equippedStackId) : undefined
    availableArrows = stack?.count ?? 0
  }

  const result = simulateOfflineProgress({
    monsterTypeId: selectedMonsterId,
    lastActiveAt: previousLastActiveAt,
    attributes,
    equipmentBonus,
    isHunter,
    availableArrows,
  })

  if (!result) {
    return null
  }

  await applyOfflineProgress(characterId, result, isHunter)
  return result
}
