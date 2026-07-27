import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// Mirrors the item_templates table. base_stats is plain jsonb, keyed to match the
// stat names in derivedStats.ts (e.g. "physical_attack") — see equipmentBonus.ts.
export interface ItemTemplate {
  id: string
  name: string
  slot_type: string
  base_stats: Record<string, number>
}

interface ItemTemplatesState {
  templates: ItemTemplate[]
  loaded: boolean
  loadTemplates: () => Promise<void>
}

// Static reference data, readable by anyone — loaded once and cached, not tied to
// the authenticated user like the player-owned stores.
export const useItemTemplatesStore = create<ItemTemplatesState>((set, get) => ({
  templates: [],
  loaded: false,

  loadTemplates: async () => {
    if (get().loaded) {
      return
    }

    const { data, error } = await supabase.from('item_templates').select('id, name, slot_type, base_stats')

    if (error) {
      console.error('Failed to load item templates', error)
      return
    }

    set({ templates: (data ?? []) as ItemTemplate[], loaded: true })
  },
}))
