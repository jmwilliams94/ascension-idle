import { useEffect } from 'react'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useZoneStore } from '../game/zones/useZoneStore'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useMineStore } from '../game/mining/useMineStore'
import { useIdleModeStore } from '../game/mining/useIdleModeStore'
import { useSkillsStore } from '../game/skills/useSkillsStore'
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
      // A Hunter's attack gate is just the Quiver item's equipped_quiver_id
      // pointer now (no ammo economy at all — see CLAUDE.md's Classes
      // section), so it's covered by the useEquipmentStore subscription below
      // like every other equip slot; nothing else needs a separate save path.
    }

    const scheduleSave = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(saveNow, AUTOSAVE_DEBOUNCE_MS)
    }

    let previousLevel = useProgressionStore.getState().level

    // Bug fix (2026-08-11): this subscriber used to fire on ANY
    // useProgressionStore change, including predictedGold/predictedLevel/
    // predictedExp — which the since-removed addPredictedRewards (see
    // useCombatStore.runTick's 2026-11 reward-on-kill comment) used to update
    // once per attack, often faster than once per 2s. That
    // meant this store's debounced save almost never got a quiet enough gap
    // to actually fire while continuously fighting, so selected_monster_id
    // (persisted on the same character row, see useCharacterRecordStore's
    // saveNow) could go stale for as long as combat kept running — a
    // monster switch mid-fight would silently keep crediting gold/EXP/kill
    // counts to the previous monster server-side until something else
    // forced a flush (level-up/tab-hide/unload). Only the real, persisted
    // level/gold/exp fields should reschedule this save.
    const unsubscribeProgression = useProgressionStore.subscribe((state, prevState) => {
      if (state.level === prevState.level && state.gold === prevState.gold && state.exp === prevState.exp) {
        return
      }
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
    // Bug fix (2026-08-22, reported by the user — real Hunting knockouts
    // while they believed they were only mining): selected_mine_id/
    // last_active_idle_mode were hydrated on load and included in saveNow's
    // payload, but nothing here ever *triggered* a save when either
    // changed — Mining grants no gold/EXP/zone/equipment change on its own,
    // so a pure mining session had almost no reliable trigger to persist
    // which mode was active, only the best-effort tab-hide/beforeunload
    // safety net below (which the comment on those handlers already admits
    // isn't guaranteed to land). A missed safety-net save meant the next
    // load read back a stale last_active_idle_mode (often 'hunting'),
    // silently resuming a real fight in the background while the player was
    // looking at the Mining page.
    const unsubscribeMine = useMineStore.subscribe(() => scheduleSave())
    const unsubscribeIdleMode = useIdleModeStore.subscribe(() => scheduleSave())
    const unsubscribeSkills = useSkillsStore.subscribe(() => scheduleSave())

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
      unsubscribeMine()
      unsubscribeIdleMode()
      unsubscribeSkills()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [characterId, loaded])
}
