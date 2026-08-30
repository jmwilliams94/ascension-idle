import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// Backs the "inspect other player's gear" view opened from a Global Chat
// name badge (2026-08-19, requested by the user) -- CharacterLoadoutModal.tsx
// is the only consumer. Purely read-only: no equip/unequip, no stats block,
// just whatever's currently equipped, same as view_character_loadout's own
// scope (see that migration's comment).
export interface LoadoutItem {
  item_id: string
  template_id: string
  quality_tier: string
  level: number
  composition_level: number
  sockets: (null | string)[]
  durability: number | null
  enchant: { hp?: number; blessPct?: number } | null
}

export type LoadoutSlot = 'weapon' | 'ring' | 'necklace' | 'boots' | 'hat' | 'coat' | 'quiver'

export interface CharacterLoadout {
  character: { name: string; level: number; class: string | null }
  equipment: Record<LoadoutSlot, LoadoutItem | null>
  gearScore: number
}

interface ViewLoadoutResult {
  ok: boolean
  error?: string
  character?: CharacterLoadout['character']
  equipment?: CharacterLoadout['equipment']
  gear_score?: number
}

interface CharacterLoadoutState {
  open: boolean
  characterName: string | null
  loading: boolean
  error: string | null
  loadout: CharacterLoadout | null
  viewCharacter: (characterName: string) => Promise<void>
  close: () => void
}

export const useCharacterLoadoutStore = create<CharacterLoadoutState>((set) => ({
  open: false,
  characterName: null,
  loading: false,
  error: null,
  loadout: null,

  viewCharacter: async (characterName) => {
    set({ open: true, characterName, loading: true, error: null, loadout: null })

    const { data, error } = await supabase.rpc('view_character_loadout', { p_character_name: characterName })

    if (error) {
      console.error('view_character_loadout call failed', error)
      set({ loading: false, error: 'rpc_failed' })
      return
    }

    const result = data as ViewLoadoutResult
    if (!result.ok || !result.character || !result.equipment) {
      set({ loading: false, error: result.error ?? 'not_found' })
      return
    }

    set({ loading: false, loadout: { character: result.character, equipment: result.equipment, gearScore: result.gear_score ?? 0 } })
  },

  close: () => set({ open: false }),
}))
