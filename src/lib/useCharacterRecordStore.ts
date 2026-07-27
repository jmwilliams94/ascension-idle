import { create } from 'zustand'
import { supabase } from './supabaseClient'
import { useActiveCharacterStore } from './useActiveCharacterStore'
import { CLASS_DEFINITIONS, type ClassId } from '../game/stats/classes'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useZoneStore } from '../game/zones/useZoneStore'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useArrowStore } from '../game/items/useArrowStore'

// Loads/saves the active character's row (characters table) — class, level, gold,
// exp, zone, equipped item, equipped arrow stack. Replaces what usePlayerRecordStore
// used to do before the character-slots restructure; that store is now
// account-level only. meteors/dragonballs are intentionally excluded from both
// load-hydration-triggers-save and saveNow — see useCurrencyStore for why
// (server-authoritative via the forge RPCs). The arrow stacks themselves live in
// arrow_stacks (see useArrowStore), not on this row — only the equipped pointer does.
interface CharacterRow {
  class: string | null
  level: number
  gold: number
  exp: number
  current_zone: string
  equipped_item_id: string | null
  meteors: number
  dragonballs: number
  equipped_arrow_stack_id: string | null
}

interface CharacterRecordState {
  // False until loadCharacterRecord's fetch + hydration has finished — autosave must
  // not start before this, or it could overwrite a saved row with whatever defaults
  // the local stores happened to start with.
  loaded: boolean
  loadCharacterRecord: (characterId: string) => Promise<void>
  saveNow: (characterId: string) => Promise<void>
}

export const useCharacterRecordStore = create<CharacterRecordState>((set, get) => ({
  loaded: false,

  loadCharacterRecord: async (characterId) => {
    set({ loaded: false })

    const { data, error } = await supabase
      .from('characters')
      .select('class, level, gold, exp, current_zone, equipped_item_id, meteors, dragonballs, equipped_arrow_stack_id')
      .eq('id', characterId)
      .maybeSingle<CharacterRow>()

    if (error || !data) {
      console.error('Failed to load character record', error)
      // The stored characterId (e.g. from last-played persistence) no longer
      // resolves to a real, owned character — bounce back to character select
      // instead of soft-locking on a character that can't load.
      useActiveCharacterStore.getState().setActiveCharacterId(null)
      return
    }

    if (data.class && data.class in CLASS_DEFINITIONS) {
      useCharacterStore.getState().selectClass(data.class as ClassId)
    }
    useProgressionStore.getState().hydrate({ level: data.level, gold: data.gold, exp: data.exp })
    useZoneStore.getState().setCurrentZoneName(data.current_zone)
    useEquipmentStore.getState().hydrate(data.equipped_item_id)
    useCurrencyStore.getState().hydrate({ meteors: data.meteors, dragonballs: data.dragonballs })
    useArrowStore.getState().setEquippedStackId(data.equipped_arrow_stack_id)

    set({ loaded: true })
  },

  saveNow: async (characterId) => {
    if (!get().loaded) {
      return
    }

    const character = useCharacterStore.getState()
    const progression = useProgressionStore.getState()
    const zone = useZoneStore.getState()
    const equipment = useEquipmentStore.getState()
    const arrows = useArrowStore.getState()

    const { error } = await supabase
      .from('characters')
      .update({
        class: character.selectedClassId,
        level: progression.level,
        gold: progression.gold,
        exp: progression.exp,
        current_zone: zone.currentZoneName,
        equipped_item_id: equipment.equippedItemId,
        equipped_arrow_stack_id: arrows.equippedStackId,
      })
      .eq('id', characterId)

    if (error) {
      console.error('Failed to save character record', error)
    }
  },
}))
