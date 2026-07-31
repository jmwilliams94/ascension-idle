import { create } from 'zustand'
import { supabase } from './supabaseClient'
import { useActiveCharacterStore } from './useActiveCharacterStore'
import { CLASS_DEFINITIONS, type ClassId } from '../game/stats/classes'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useZoneStore } from '../game/zones/useZoneStore'
import { useEquipmentStore, type EquipSlot } from '../game/items/useEquipmentStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useCompositionStore, type CompositionStones } from '../game/items/useCompositionStore'
import { useWarehouseStore } from '../game/items/useWarehouseStore'

// Loads/saves the active character's row (characters table) — class, level, gold,
// exp, zone, equipped items (including the Quiver, for Hunters). Replaces what
// usePlayerRecordStore used to do before the character-slots restructure; that
// store is now account-level only. meteors/dragonballs/composition_stones are
// intentionally excluded from both load-hydration-triggers-save and saveNow —
// see useCurrencyStore for why (server-authoritative via the forge RPCs). The
// Quiver is just an equipped item like any other slot (equipped_quiver_id) —
// having it equipped is the entire Hunter attack gate now, no ammo economy.
interface CharacterRow {
  name: string
  class: string | null
  level: number
  gold: number
  exp: number
  current_zone: string
  equipped_weapon_id: string | null
  equipped_ring_id: string | null
  equipped_necklace_id: string | null
  equipped_boots_id: string | null
  equipped_hat_id: string | null
  equipped_coat_id: string | null
  equipped_quiver_id: string | null
  meteors: number
  dragonballs: number
  composition_stones: CompositionStones
  warehouse_points: number
  selected_monster_id: string | null
  last_active_at: string
}

interface CharacterRecordState {
  // False until loadCharacterRecord's fetch + hydration has finished — autosave must
  // not start before this, or it could overwrite a saved row with whatever defaults
  // the local stores happened to start with.
  loaded: boolean
  // The row's last_active_at value as it was *before* this load (captured prior to
  // the post-load saveNow that refreshes it) — read once by the offline-progress
  // calculator to compute elapsed real-world time since the character was last
  // active. Null only for a character that predates this column's default.
  previousLastActiveAt: string | null
  // The active character's name — display-only here (naming itself is fixed at
  // creation, see CLAUDE.md's Character naming note), used wherever the UI shows
  // the player by name instead of a generic "Your ___" label.
  characterName: string
  loadCharacterRecord: (characterId: string) => Promise<void>
  saveNow: (characterId: string) => Promise<void>
}

export const useCharacterRecordStore = create<CharacterRecordState>((set, get) => ({
  loaded: false,
  previousLastActiveAt: null,
  characterName: '',

  loadCharacterRecord: async (characterId) => {
    set({ loaded: false })

    const { data, error } = await supabase
      .from('characters')
      .select(
        'name, class, level, gold, exp, current_zone, equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id, equipped_hat_id, equipped_coat_id, equipped_quiver_id, meteors, dragonballs, composition_stones, warehouse_points, selected_monster_id, last_active_at',
      )
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
    useZoneStore.getState().hydrate({ zoneId: data.current_zone, monsterId: data.selected_monster_id })
    useEquipmentStore.getState().hydrate({
      weapon: data.equipped_weapon_id,
      ring: data.equipped_ring_id,
      necklace: data.equipped_necklace_id,
      boots: data.equipped_boots_id,
      hat: data.equipped_hat_id,
      coat: data.equipped_coat_id,
      quiver: data.equipped_quiver_id,
    } satisfies Record<EquipSlot, string | null>)
    useCurrencyStore.getState().hydrate({ meteors: data.meteors, dragonballs: data.dragonballs })
    useCompositionStore.getState().hydrate(data.composition_stones)
    useWarehouseStore.getState().hydratePoints(data.warehouse_points)

    set({ loaded: true, previousLastActiveAt: data.last_active_at, characterName: data.name })
  },

  saveNow: async (characterId) => {
    if (!get().loaded) {
      return
    }

    const character = useCharacterStore.getState()
    const progression = useProgressionStore.getState()
    const zone = useZoneStore.getState()
    const equipment = useEquipmentStore.getState()

    const { error } = await supabase
      .from('characters')
      .update({
        class: character.selectedClassId,
        level: progression.level,
        gold: progression.gold,
        exp: progression.exp,
        current_zone: zone.currentZoneId,
        equipped_weapon_id: equipment.equippedIds.weapon,
        equipped_ring_id: equipment.equippedIds.ring,
        equipped_necklace_id: equipment.equippedIds.necklace,
        equipped_boots_id: equipment.equippedIds.boots,
        equipped_hat_id: equipment.equippedIds.hat,
        equipped_coat_id: equipment.equippedIds.coat,
        equipped_quiver_id: equipment.equippedIds.quiver,
        selected_monster_id: zone.selectedMonsterId,
        last_active_at: new Date().toISOString(),
      })
      .eq('id', characterId)

    if (error) {
      console.error('Failed to save character record', error)
    }
  },
}))
