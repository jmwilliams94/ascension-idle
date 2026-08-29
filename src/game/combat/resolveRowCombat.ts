import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useInventoryFullWarningStore } from '../items/useInventoryFullWarningStore'
import { markDropSourced } from '../items/dropSourceTracking'
import { useAchievementsStore } from '../achievements/useAchievementsStore'
import { usePetToastStore } from '../achievements/usePetToastStore'
import { useKillRewardToastStore } from '../hud/useKillRewardToastStore'
import { ENEMY_TYPES, type EnemyTypeId } from '../zones/zoneData'
import { useRowCombatStore, type ServerRowSlot } from './useRowCombatStore'
import { serializeByKey } from './serializeByKey'

// Row Combat's sole grantor of real rewards — mirrors resolveCombat.ts's own
// role/shape exactly, but for resolve-row-combat. Always effectively "live
// mode" (there is no offline path for this combat mode at all — see
// resolve-row-combat/index.ts's header). useRowCombatStore's own tick loop
// is prediction-only; this is what actually reconciles it.
export interface ResolveRowCombatResult {
  ok: boolean
  error?: string
  elapsedMs?: number
  gained?: { kills: number; rareKills: number; gold: number; exp: number }
  character?: { gold: number; exp: number; level: number; comets: number; fallenStars: number }
  leveledUp?: boolean
  itemsGranted?: ItemInstance[]
  inventoryFull?: boolean
  rowSlots?: ServerRowSlot[]
  multiShotFired?: boolean
  multiShotOnCooldown?: boolean
  multiShotNoTarget?: boolean
  multiShotReadyAt?: string
  multiShotHits?: { slotIndex: number; hit: boolean; damage: number }[]
  petObtained?: string | null
  killCountUpdates?: { monster_id: string; character_kills: number | string; account_kills: number | string }[]
}

// Serialized per character — mirrors resolveCombat.ts's own fix, see
// serializeByKey.ts for the full race this closes. Queueing rather than
// dropping an overlapping call matters here specifically because
// RowCombatPanel.tsx awaits this directly for a Multi-Shot button click —
// a "skip if busy" guard would silently eat that click if the periodic
// engine tick happened to be in flight at the same moment.
export function resolveRowCombat(
  characterId: string,
  options?: { fireMultiShot?: boolean },
): Promise<ResolveRowCombatResult | null> {
  return serializeByKey(characterId, () => resolveRowCombatInner(characterId, options))
}

async function resolveRowCombatInner(
  characterId: string,
  options?: { fireMultiShot?: boolean },
): Promise<ResolveRowCombatResult | null> {
  const { data, error } = await supabase.functions.invoke('resolve-row-combat', {
    body: { characterId, fireMultiShot: options?.fireMultiShot ?? false },
  })

  if (error) {
    console.error('resolve-row-combat call failed', error)
    return null
  }

  const result = data as ResolveRowCombatResult

  if (!result.ok || !result.character) {
    return result
  }

  useProgressionStore.getState().applyServerCombatResult({
    goldGained: result.gained?.gold ?? 0,
    exp: result.character.exp,
    level: result.character.level,
  })
  useCurrencyStore.getState().setComets(result.character.comets)
  useCurrencyStore.getState().setFallenStars(result.character.fallenStars)

  // "Kill confirmed" toast (see useKillRewardToastStore.ts) — always live for
  // Row Combat (no offline path exists for it, see this file's own header),
  // so no mode check needed here unlike resolveCombat.ts's own version. One
  // toast per resolve call already totals every row slot's kills this window
  // covered, not one per slot.
  if (result.gained && result.gained.kills > 0) {
    useKillRewardToastStore.getState().show({
      gold: result.gained.gold,
      exp: result.gained.exp,
      kills: result.gained.kills,
      rareKills: result.gained.rareKills,
    })
  }

  for (const item of result.itemsGranted ?? []) {
    useInventoryStore.getState().addItem(item)
    markDropSourced(item.id)
  }

  if (result.rowSlots) {
    useRowCombatStore.getState().applyServerSlots(result.rowSlots)
  }

  if (result.multiShotHits && result.multiShotHits.length > 0) {
    useRowCombatStore.getState().applyMultiShotHits(result.multiShotHits)
  }

  if (result.multiShotReadyAt) {
    useRowCombatStore.getState().applyServerMultiShotReadyAt(result.multiShotReadyAt)
  }

  if (result.inventoryFull) {
    useRowCombatStore.getState().stopAllForInventoryFull()
    useInventoryFullWarningStore.getState().trigger()
  }

  for (const update of result.killCountUpdates ?? []) {
    useAchievementsStore
      .getState()
      .applyResolveResult(
        update.monster_id,
        Number(update.character_kills),
        Number(update.account_kills),
        result.petObtained === update.monster_id ? result.petObtained : null,
      )
  }

  if (result.petObtained) {
    const type = ENEMY_TYPES[result.petObtained as EnemyTypeId]
    usePetToastStore.getState().show(type?.displayName ?? 'monster')
  }

  return result
}
