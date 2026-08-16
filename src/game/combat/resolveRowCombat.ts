import { supabase } from '../../lib/supabaseClient'
import { useProgressionStore } from '../stats/useProgressionStore'
import { useCurrencyStore } from '../stats/useCurrencyStore'
import { useInventoryStore, type ItemInstance } from '../items/useInventoryStore'
import { useInventoryFullWarningStore } from '../items/useInventoryFullWarningStore'
import { useAchievementsStore } from '../achievements/useAchievementsStore'
import { usePetToastStore } from '../achievements/usePetToastStore'
import { ENEMY_TYPES, type EnemyTypeId } from '../zones/zoneData'
import { useRowCombatStore, type ServerRowSlot } from './useRowCombatStore'

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
  multiShotReadyAt?: string
  petObtained?: string | null
  killCountUpdates?: { monster_id: string; character_kills: number | string; account_kills: number | string }[]
}

export async function resolveRowCombat(
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

  for (const item of result.itemsGranted ?? []) {
    useInventoryStore.getState().addItem(item)
  }

  if (result.rowSlots) {
    useRowCombatStore.getState().applyServerSlots(result.rowSlots)
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
