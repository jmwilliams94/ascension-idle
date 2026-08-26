import { create } from 'zustand'
import { supabase } from './supabaseClient'
import type { ClassId } from '../game/stats/classes'

export const MAX_CHARACTER_SLOTS = 5

// Name format: exactly one leading capital letter, then lowercase letters only —
// mirrors the DB's characters_name_format_check constraint. Client-side check is
// just for immediate feedback; the DB constraint (and the unique constraint) are
// the real enforcement.
export const CHARACTER_NAME_PATTERN = /^[A-Z][a-z]*$/

export interface CharacterSlotSummary {
  id: string
  slotIndex: number
  classId: string | null
  level: number
  name: string
}

export type CreateCharacterResult =
  | { ok: true; id: string }
  | { ok: false; error: 'duplicate_name' | 'invalid_name' | 'unknown' }

// Hunters start with a Quiver + a real Bow already equipped (confirmed with
// the user, 2026-07-31); Wuxia starts with the Level 1 Lucky Backsword
// equipped (20261019000000_wuxia_starter_weapon.sql), no second item since
// its off-hand slot is a non-interactive echo of Main Hand. Used to be two
// direct client-side item_instances inserts + equip updates — only worked
// because of a since-revoked blanket INSERT grant (see migration
// 20260821000000_lock_down_direct_table_writes.sql, which also closed the
// same grant for the Shop-purchase path). Now a single SECURITY DEFINER RPC
// that creates + equips in one transaction and refuses to run twice for the
// same character. Best-effort: a failure here logs but doesn't fail
// character creation — missing starter items are recoverable (buyable in
// the Shop), unlike the character row itself.
async function grantStarterItems(characterId: string): Promise<void> {
  const { error } = await supabase.rpc('grant_starter_items', { p_character_id: characterId })

  if (error) {
    console.error('Failed to grant starter items', error)
  }
}

interface CharacterRosterState {
  loaded: boolean
  // Fixed-length array of MAX_CHARACTER_SLOTS — index 0 is slot 1, etc. Null means
  // that slot is empty (available for "Create Character").
  slots: (CharacterSlotSummary | null)[]
  loadRoster: (accountId: string) => Promise<void>
  createCharacter: (accountId: string, slotIndex: number, classId: ClassId, name: string) => Promise<CreateCharacterResult>
  deleteCharacter: (characterId: string, slotIndex: number) => Promise<boolean>
}

export const useCharacterRosterStore = create<CharacterRosterState>((set) => ({
  loaded: false,
  slots: Array.from({ length: MAX_CHARACTER_SLOTS }, () => null),

  loadRoster: async (accountId) => {
    const { data, error } = await supabase
      .from('characters')
      .select('id, slot_index, class, level, name')
      .eq('account_id', accountId)
      .order('slot_index', { ascending: true })

    if (error) {
      console.error('Failed to load character roster', error)
      return
    }

    const slots: (CharacterSlotSummary | null)[] = Array.from({ length: MAX_CHARACTER_SLOTS }, () => null)

    for (const row of data ?? []) {
      const index = row.slot_index - 1
      if (index >= 0 && index < MAX_CHARACTER_SLOTS) {
        slots[index] = { id: row.id, slotIndex: row.slot_index, classId: row.class, level: row.level, name: row.name }
      }
    }

    set({ slots, loaded: true })
  },

  createCharacter: async (accountId, slotIndex, classId, name) => {
    const { data, error } = await supabase
      .from('characters')
      .insert({ account_id: accountId, slot_index: slotIndex, class: classId, name })
      .select('id, slot_index, class, level, name')
      .single()

    if (error) {
      console.error('Failed to create character', error)
      // 23505 = unique_violation (name taken), 23514 = check_violation (bad format,
      // shouldn't normally reach here since the UI validates first, but the DB
      // constraint is the real backstop).
      if (error.code === '23505') {
        return { ok: false, error: 'duplicate_name' }
      }
      if (error.code === '23514') {
        return { ok: false, error: 'invalid_name' }
      }
      return { ok: false, error: 'unknown' }
    }

    if (classId === 'hunter' || classId === 'wuxia') {
      await grantStarterItems(data.id)
    }

    set((state) => {
      const slots = [...state.slots]
      slots[slotIndex - 1] = {
        id: data.id,
        slotIndex: data.slot_index,
        classId: data.class,
        level: data.level,
        name: data.name,
      }
      return { slots }
    })

    return { ok: true, id: data.id as string }
  },

  deleteCharacter: async (characterId, slotIndex) => {
    const { error } = await supabase.from('characters').delete().eq('id', characterId)

    if (error) {
      console.error('Failed to delete character', error)
      return false
    }

    set((state) => {
      const slots = [...state.slots]
      slots[slotIndex - 1] = null
      return { slots }
    })

    return true
  },
}))
