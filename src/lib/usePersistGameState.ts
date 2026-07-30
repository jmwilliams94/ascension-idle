import { useEffect } from 'react'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useZoneStore } from '../game/zones/useZoneStore'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useCharacterRecordStore } from './useCharacterRecordStore'

const AUTOSAVE_DEBOUNCE_MS = 2000

// Wires up the save side of persistence once the initial load has finished: a
// debounced autosave on any gold/exp/level/class/zone/equipped-item change, an
// immediate save on level-up (bypassing the debounce — too meaningful a moment to
// risk losing), and a best-effort save when the tab is hidden or closed as a safety
// net for whatever the debounce hasn't flushed yet. Saves to the active character's
// row (characters table), not the account (players table).
export function usePersistGameState(characterId: string | undefined, loaded: boolean) {
  useEffect(() => {
    if (!characterId || !loaded) {
      return undefined
    }

    let debounceTimer: ReturnType<typeof setTimeout> | undefined

    const saveNow = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = undefined
      }
      void useCharacterRecordStore.getState().saveNow(characterId)
      // Arrow stack COUNTS are no longer saved here — combat depletion is now
      // server-authoritative via resolve-combat (see resolveCombat.ts), and
      // re-saving this store's locally-predicted (possibly stale) count here
      // could otherwise clobber the server's own, more accurate value between
      // resolves. This subscription still exists so equipping a different
      // stack (setEquippedStackId) triggers the characters-row save above,
      // which is what actually persists equipped_arrow_stack_id.
    }

    const scheduleSave = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(saveNow, AUTOSAVE_DEBOUNCE_MS)
    }

    let previousLevel = useProgressionStore.getState().level

    const unsubscribeProgression = useProgressionStore.subscribe((state) => {
      if (state.level > previousLevel) {
        previousLevel = state.level
        saveNow()
      } else {
        previousLevel = state.level
        scheduleSave()
      }
    })

    const unsubscribeCharacter = useCharacterStore.subscribe(() => scheduleSave())
    const unsubscribeZone = useZoneStore.subscribe(() => scheduleSave())
    const unsubscribeEquipment = useEquipmentStore.subscribe(() => scheduleSave())
    const unsubscribeArrows = useArrowStore.subscribe(() => scheduleSave())

    // beforeunload isn't reliable (browsers may not wait for the fetch to complete),
    // and visibilitychange 'hidden' fires on tab switch/backgrounding too, giving the
    // request more of a chance to actually land — using both is standard practice
    // since neither alone is guaranteed on every platform.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveNow()
      }
    }
    const handleBeforeUnload = () => {
      saveNow()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      unsubscribeProgression()
      unsubscribeCharacter()
      unsubscribeZone()
      unsubscribeEquipment()
      unsubscribeArrows()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [characterId, loaded])
}
