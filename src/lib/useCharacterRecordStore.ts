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
import { useGemStore } from '../game/items/useGemStore'
import type { GemCounts } from '../game/items/gemTypes'
import { useLuckyStore } from '../game/lucky/useLuckyStore'

// Loads/saves the active character's row (characters table) — class, level, gold,
// exp, zone, equipped items (including the Quiver, for Hunters). Replaces what
// usePlayerRecordStore used to do before the character-slots restructure; that
// store is now account-level only. comets/fallen_stars/composition_stones are
// intentionally excluded from both load-hydration-triggers-save and saveNow —
// see useCurrencyStore for why (server-authoritative via the forge RPCs).
// Ascension Points, and (2026-08-03, Bank tab rework) the entire Bank Storage
// system — bank_points/gear_composition_points/comet_bank_count/
// fallen_star_bank_count/composition_stones_banked — all live on the account
// (players table, see usePlayerRecordStore) rather than here now, not
// per-character. The
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
  comet_count: number
  fallen_star_count: number
  comet_scroll_count: number
  fallen_star_scroll_count: number
  // Lottery Ticket (2026-08-06, Achievements rework) — same trust model as
  // the counts above (server-authoritative, excluded from saveNow below).
  lottery_ticket_count: number
  composition_stones: CompositionStones
  // First real hydration of this column (Lucky Lad rewards expansion,
  // 2026-08-09) — see useGemStore.ts. Same server-authoritative trust model
  // as composition_stones above (excluded from saveNow below).
  gems: GemCounts
  selected_monster_id: string | null
  last_active_at: string
  // Server-authoritative, same trust model as comet_count/fallen_star_count
  // above — only ever written by draw_lucky_ticket, never the generic
  // autosave (see saveNow below).
  lucky_free_ticket_claimed_at: string | null
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
        'name, class, level, gold, exp, current_zone, equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id, equipped_hat_id, equipped_coat_id, equipped_quiver_id, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count, lottery_ticket_count, composition_stones, gems, selected_monster_id, last_active_at, lucky_free_ticket_claimed_at',
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
    useCurrencyStore.getState().hydrate({
      comets: data.comet_count,
      fallenStars: data.fallen_star_count,
      cometScrolls: data.comet_scroll_count,
      fallenStarScrolls: data.fallen_star_scroll_count,
      lotteryTickets: data.lottery_ticket_count,
    })
    useCompositionStore.getState().hydrate(data.composition_stones)
    useGemStore.getState().hydrate(data.gems)
    useLuckyStore.getState().hydrate(data.lucky_free_ticket_claimed_at)

    set({ loaded: true, previousLastActiveAt: data.last_active_at, characterName: data.name })
  },

  saveNow: async (characterId) => {
    if (!get().loaded) {
      return
    }

    const zone = useZoneStore.getState()
    const equipment = useEquipmentStore.getState()

    // gold/level/exp/class are deliberately NOT written here — `characters`
    // only grants `authenticated` UPDATE on the session/cosmetic columns
    // below (see migration 20260821000000_lock_down_direct_table_writes.sql).
    // Those fields are server-authoritative now: gold/level/exp move only via
    // resolve-combat (service role) or a SECURITY DEFINER RPC that validates
    // the change, and class is fixed at creation and never changes again.
    const { error } = await supabase
      .from('characters')
      .update({
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
