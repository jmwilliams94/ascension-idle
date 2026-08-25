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
import { useCombatStore } from '../game/combat/useCombatStore'
import { useRowCombatStore, type ServerRowSlot } from '../game/combat/useRowCombatStore'
import { useMineStore } from '../game/mining/useMineStore'
import { useIdleModeStore } from '../game/mining/useIdleModeStore'
import { useVipAutomationStore } from '../game/vip/useVipAutomationStore'
import { useSkillsStore } from '../game/skills/useSkillsStore'

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
  // Comet Box (2026-08-25, redesigned from an instant grant into a real
  // inventory item) — same trust model as the counts above.
  comet_box_count: number
  // Lottery Ticket (2026-08-06, Achievements rework) — same trust model as
  // the counts above (server-authoritative, excluded from saveNow below).
  lottery_ticket_count: number
  // VIP Token (groundwork only) — same trust model as comet_box_count above.
  vip_token_count: number
  // VIP status expiry (groundwork only) — server-authoritative, only ever
  // written by use_vip_token, excluded from saveNow below.
  vip_expires_at: string | null
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
  // Class Promotion (2026-09-01) — same trust model as above, only ever
  // written by promote_character, never the generic autosave.
  promotion_level: number
  // Row Combat (Phase 1) — same trust model as comet_count/gems above,
  // never touched by the generic autosave; only resolve-row-combat/
  // toggle_row_slot/claim_row_unlock ever write these.
  row1_unlocked: boolean
  row2_unlocked: boolean
  row_slots: ServerRowSlot[]
  // Mining (see supabase/migrations/20260926000000_add_mining_pickaxe.sql) —
  // selected_mine_id/last_active_idle_mode are session/cosmetic, same
  // client-writable treatment as selected_monster_id/current_zone.
  // pickaxe_ascended_gem_type is server-authoritative (only
  // pickaxe_tier_upgrade ever writes it) — exposed via CharacterRecordState
  // below rather than hydrated straight into a store here. Pickaxe equip
  // state itself is no longer tracked separately (2026-09-30, requested by
  // the user) — it's a normal Main Hand weapon now, sharing
  // equipped_weapon_id/useEquipmentStore with the character's real weapon.
  selected_mine_id: string | null
  last_active_idle_mode: string
  pickaxe_ascended_gem_type: string | null
  // VIP automation settings (v1.108.0) — RPC-only writes (see
  // set_vip_automation_settings), same trust model as composition_stones/gems
  // above; excluded from saveNow below.
  vip_automation_settings: unknown
  // First active skill (2026-10) — session/cosmetic-tier trust, same as
  // selected_monster_id/selected_mine_id: plain client-writable column,
  // re-validated (class match) wherever combat actually applies it rather
  // than at write time.
  equipped_skill_id: string | null
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
  pickaxeAscendedGemType: string | null
  loadCharacterRecord: (characterId: string) => Promise<void>
  saveNow: (characterId: string) => Promise<void>
}

export const useCharacterRecordStore = create<CharacterRecordState>((set, get) => ({
  loaded: false,
  previousLastActiveAt: null,
  characterName: '',
  pickaxeAscendedGemType: null,

  loadCharacterRecord: async (characterId) => {
    set({ loaded: false })

    // Bug fix: useCombatStore (isFighting/monsterTypeId/HP) is a global store
    // that persists across a character switch — nothing was ever resetting it,
    // unlike zone/equipment/currency below, which all get a real hydrate()
    // call. Switching characters mid-fight (without a full page reload, which
    // resets every JS module from scratch) left a "zombie" fight running:
    // CombatEngine's tick loop kept ticking against the PREVIOUS character's
    // monster, producing real-looking damage/EXP-bar animation via
    // addPredictedRewards, while resolve-combat's periodic calls — correctly
    // scoped to the new active characterId — found no real monster selected
    // server-side and kept confirming 0 progress. That server 0 is what
    // applyServerCombatResult resyncs predictedExp back down to every ~4s,
    // producing the "climbs a few %, snaps back to 0" cycle. Mirrors the
    // existing zone-switch precedent (CombatPage.tsx's handleSelectZone
    // already calls this same clear() before switching zones).
    useCombatStore.getState().clear()
    // Same "zombie fight" bug fix as useCombatStore.clear() above, applied to
    // Row Combat — reset before the fetch so a character switch can't leave
    // RowCombatEngine ticking against the previous character's slots.
    useRowCombatStore.getState().applyServerSlots([])
    useRowCombatStore.getState().setUnlocked(false, false)

    const { data, error } = await supabase
      .from('characters')
      .select(
        'name, class, level, gold, exp, current_zone, equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id, equipped_hat_id, equipped_coat_id, equipped_quiver_id, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count, comet_box_count, lottery_ticket_count, vip_token_count, vip_expires_at, composition_stones, gems, selected_monster_id, last_active_at, lucky_free_ticket_claimed_at, promotion_level, row1_unlocked, row2_unlocked, row_slots, selected_mine_id, last_active_idle_mode, pickaxe_ascended_gem_type, vip_automation_settings, equipped_skill_id',
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
    useCharacterStore.getState().setPromotionLevel(data.promotion_level)
    useCharacterStore.getState().setVipExpiresAt(data.vip_expires_at)
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
      cometBoxes: data.comet_box_count,
      lotteryTickets: data.lottery_ticket_count,
      vipTokens: data.vip_token_count,
    })
    useCompositionStore.getState().hydrate(data.composition_stones)
    useGemStore.getState().hydrate(data.gems)
    useLuckyStore.getState().hydrate(data.lucky_free_ticket_claimed_at)
    useRowCombatStore.getState().setUnlocked(data.row1_unlocked, data.row2_unlocked)
    useRowCombatStore.getState().applyServerSlots(data.row_slots ?? [])
    useMineStore.getState().hydrate({ mineId: data.selected_mine_id })
    useIdleModeStore.getState().hydrate(data.last_active_idle_mode)
    useVipAutomationStore.getState().hydrate(data.vip_automation_settings)
    useSkillsStore.getState().hydrate({ skillId: data.equipped_skill_id })

    set({
      loaded: true,
      previousLastActiveAt: data.last_active_at,
      characterName: data.name,
      pickaxeAscendedGemType: data.pickaxe_ascended_gem_type,
    })
  },

  saveNow: async (characterId) => {
    if (!get().loaded) {
      return
    }

    const zone = useZoneStore.getState()
    const equipment = useEquipmentStore.getState()
    const mine = useMineStore.getState()
    const idleMode = useIdleModeStore.getState()
    const skills = useSkillsStore.getState()

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
        selected_mine_id: mine.currentMineId,
        last_active_idle_mode: idleMode.lastActiveIdleMode,
        equipped_skill_id: skills.equippedSkillId,
        last_active_at: new Date().toISOString(),
      })
      .eq('id', characterId)

    if (error) {
      console.error('Failed to save character record', error)
    }
  },
}))
