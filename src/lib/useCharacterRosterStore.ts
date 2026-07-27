import { create } from 'zustand'
import { supabase } from './supabaseClient'
import type { ClassId } from '../game/stats/classes'

export const MAX_CHARACTER_SLOTS = 5

export interface CharacterSlotSummary {
  id: string
  slotIndex: number
  classId: string | null
  level: number
}

interface CharacterRosterState {
  loaded: boolean
  // Fixed-length array of MAX_CHARACTER_SLOTS — index 0 is slot 1, etc. Null means
  // that slot is empty (available for "Create Character").
  slots: (CharacterSlotSummary | null)[]
  loadRoster: (accountId: string) => Promise<void>
  createCharacter: (accountId: string, slotIndex: number, classId: ClassId) => Promise<string | null>
}

export const useCharacterRosterStore = create<CharacterRosterState>((set) => ({
  loaded: false,
  slots: Array.from({ length: MAX_CHARACTER_SLOTS }, () => null),

  loadRoster: async (accountId) => {
    const { data, error } = await supabase
      .from('characters')
      .select('id, slot_index, class, level')
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
        slots[index] = { id: row.id, slotIndex: row.slot_index, classId: row.class, level: row.level }
      }
    }

    set({ slots, loaded: true })
  },

  createCharacter: async (accountId, slotIndex, classId) => {
    const { data, error } = await supabase
      .from('characters')
      .insert({ account_id: accountId, slot_index: slotIndex, class: classId })
      .select('id, slot_index, class, level')
      .single()

    if (error) {
      console.error('Failed to create character', error)
      return null
    }

    set((state) => {
      const slots = [...state.slots]
      slots[slotIndex - 1] = { id: data.id, slotIndex: data.slot_index, classId: data.class, level: data.level }
      return { slots }
    })

    return data.id as string
  },
}))
