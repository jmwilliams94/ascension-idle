import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import { useActiveCharacterStore } from '../../lib/useActiveCharacterStore'
import { useItemTemplatesStore, type ItemTemplate } from './useItemTemplatesStore'

// Mirrors the item_instances table. composition_level/sockets/enchant are unused
// this step — they exist so a later step doesn't need a schema rework. quality_tier
// and level are only ever changed server-side via the quality_upgrade/level_upgrade
// Postgres functions (see useForgeStore) — never write them via a normal update().
// owner_id references characters.id (a specific character), not the account.
export interface ItemInstance {
  id: string
  template_id: string
  owner_id: string
  quality_tier: string
  level: number
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
  loadInventory: (characterId: string) => Promise<void>
  // Returns the granted item + its template on a successful drop, or null (no drop,
  // no active character, or an error) — lets the caller (the combat scene) show
  // ground-drop text without this store needing to know anything about tiles/rendering.
  rollDropForKill: () => Promise<{ item: ItemInstance; template: ItemTemplate } | null>
  // Reflects a successful quality_upgrade/level_upgrade RPC result in the local
  // cache — the functions already wrote the real values server-side, this just
  // keeps the client's copy in sync without a full refetch.
  patchItem: (itemId: string, patch: Partial<Pick<ItemInstance, 'quality_tier' | 'level'>>) => void
}

export const useInventoryStore = create<InventoryState>((set) => ({
  items: [],
  loaded: false,

  loadInventory: async (characterId) => {
    const { data, error } = await supabase.from('item_instances').select('*').eq('owner_id', characterId)

    if (error) {
      console.error('Failed to load inventory', error)
      return
    }

    set({ items: (data ?? []) as ItemInstance[], loaded: true })
  },

  rollDropForKill: async () => {
    const characterId = useActiveCharacterStore.getState().characterId
    const templates = useItemTemplatesStore.getState().templates

    if (!characterId || templates.length === 0 || Math.random() >= DROP_CHANCE) {
      return null
    }

    // Only one item type exists this step, so there's nothing to pick between yet —
    // future steps will roll against a real weighted loot table here instead.
    const template = templates[0]

    const { data, error } = await supabase
      .from('item_instances')
      .insert({ template_id: template.id, owner_id: characterId })
      .select('*')
      .single()

    if (error) {
      console.error('Failed to grant item drop', error)
      return null
    }

    const item = data as ItemInstance
    set((state) => ({ items: [...state.items, item] }))
    return { item, template }
  },

  patchItem: (itemId, patch) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    }))
  },
}))
