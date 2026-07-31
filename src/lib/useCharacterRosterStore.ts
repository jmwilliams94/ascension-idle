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

// Hunters start with a Quiver already equipped (confirmed with the user,
// 2026-07-31) — the first starter-item grant this game has ever had (the
// legacy "Wooden Sword" is just a seeded template, never auto-granted to
// anyone). Best-effort: a failure here logs but doesn't fail character
// creation — a missing starter item is recoverable (buyable in the Shop),
// unlike the character row itself.
async function grantStarterQuiver(characterId: string): Promise<void> {
  const { data: template, error: templateError } = await supabase
    .from('item_templates')
    .select('id, required_level')
    .eq('name', "Hunter's Quiver")
    .maybeSingle()

  if (templateError || !template) {
    console.error('Failed to find starter Quiver template', templateError)
    return
  }

  const { data: item, error: itemError } = await supabase
    .from('item_instances')
    .insert({ template_id: template.id, owner_id: characterId, level: template.required_level })
    .select('id')
    .single()

  if (itemError || !item) {
    console.error('Failed to grant starter Quiver', itemError)
    return
  }

  const { error: equipError } = await supabase.from('characters').update({ equipped_quiver_id: item.id }).eq('id', characterId)

  if (equipError) {
    console.error('Failed to auto-equip starter Quiver', equipError)
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

    if (classId === 'hunter') {
      await grantStarterQuiver(data.id)
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
