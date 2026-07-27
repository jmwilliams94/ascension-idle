import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../../lib/useAuthStore'
import { useItemTemplatesStore } from './useItemTemplatesStore'

// Mirrors the item_instances table. quality_tier/composition_level/sockets/enchant
// are unused this step — they exist so a later step doesn't need a schema rework.
export interface ItemInstance {
  id: string
  template_id: string
  owner_id: string
  quality_tier: string | null
  composition_level: number
  sockets: unknown[]
  enchant: unknown | null
  created_at: string
}

// PLACEHOLDER drop chance — real drop rates are unresolved per CLAUDE.md.
const DROP_CHANCE = 0.1

interface InventoryState {
  items: ItemInstance[]
  loaded: boolean
  loadInventory: (userId: string) => Promise<void>
  rollDropForKill: () => Promise<void>
}

export const useInventoryStore = create<InventoryState>((set) => ({
  items: [],
  loaded: false,

  loadInventory: async (userId) => {
    const { data, error } = await supabase.from('item_instances').select('*').eq('owner_id', userId)

    if (error) {
      console.error('Failed to load inventory', error)
      return
    }

    set({ items: (data ?? []) as ItemInstance[], loaded: true })
  },

  rollDropForKill: async () => {
    const userId = useAuthStore.getState().session?.user.id
    const templates = useItemTemplatesStore.getState().templates

    if (!userId || templates.length === 0 || Math.random() >= DROP_CHANCE) {
      return
    }

    // Only one item type exists this step, so there's nothing to pick between yet —
    // future steps will roll against a real weighted loot table here instead.
    const template = templates[0]

    const { data, error } = await supabase
      .from('item_instances')
      .insert({ template_id: template.id, owner_id: userId })
      .select('*')
      .single()

    if (error) {
      console.error('Failed to grant item drop', error)
      return
    }

    set((state) => ({ items: [...state.items, data as ItemInstance] }))
  },
}))
