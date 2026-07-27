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

// Fixed for now — the real scaling-by-level model (30 up to 40 slots, see CLAUDE.md's
// Inventory section) isn't built yet, so every character is treated as already at the
// max cap.
export const INVENTORY_SLOT_CAP = 40

interface InventoryState {
  items: ItemInstance[]
  loaded: boolean
  // Set when a drop occurs while the inventory is already full during active play —
  // holds the template that would have been granted, awaiting the player's choice of
  // what to discard (see resolvePendingDrop). Null means no decision pending.
  pendingFullDrop: { template: ItemTemplate } | null
  loadInventory: (characterId: string) => Promise<void>
  // Returns the granted item + its template on a successful drop, or null (no drop,
  // no active character, an error, or the inventory is full) — lets the caller (the
  // combat scene) show ground-drop text without this store needing to know anything
  // about tiles/rendering. `interactive` distinguishes actively-played kills (the only
  // path that exists today) from the not-yet-built AFK/offline simulation (see
  // CLAUDE.md's Persistence section) — a full inventory silently wastes the drop when
  // not interactive, or surfaces pendingFullDrop for the player to resolve when it is.
  rollDropForKill: (interactive?: boolean) => Promise<{ item: ItemInstance; template: ItemTemplate } | null>
  // Reflects a successful quality_upgrade/level_upgrade RPC result in the local
  // cache — the functions already wrote the real values server-side, this just
  // keeps the client's copy in sync without a full refetch.
  patchItem: (itemId: string, patch: Partial<Pick<ItemInstance, 'quality_tier' | 'level'>>) => void
  // Resolves a pendingFullDrop: pass an existing item's id to discard it and grant
  // the new drop in its place, or null to discard the new drop instead and keep the
  // inventory as-is.
  resolvePendingDrop: (discardItemId: string | null) => Promise<void>
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  items: [],
  loaded: false,
  pendingFullDrop: null,

  loadInventory: async (characterId) => {
    const { data, error } = await supabase.from('item_instances').select('*').eq('owner_id', characterId)

    if (error) {
      console.error('Failed to load inventory', error)
      return
    }

    set({ items: (data ?? []) as ItemInstance[], loaded: true })
  },

  rollDropForKill: async (interactive = true) => {
    const characterId = useActiveCharacterStore.getState().characterId
    const templates = useItemTemplatesStore.getState().templates

    if (!characterId || templates.length === 0 || Math.random() >= DROP_CHANCE) {
      return null
    }

    // Only one item type exists this step, so there's nothing to pick between yet —
    // future steps will roll against a real weighted loot table here instead.
    const template = templates[0]

    if (get().items.length >= INVENTORY_SLOT_CAP) {
      if (!interactive) {
        return null
      }

      set({ pendingFullDrop: { template } })
      return null
    }

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

  resolvePendingDrop: async (discardItemId) => {
    const pending = get().pendingFullDrop
    if (!pending) {
      return
    }

    if (discardItemId === null) {
      set({ pendingFullDrop: null })
      return
    }

    const characterId = useActiveCharacterStore.getState().characterId
    if (!characterId) {
      set({ pendingFullDrop: null })
      return
    }

    const { error: deleteError } = await supabase.from('item_instances').delete().eq('id', discardItemId)
    if (deleteError) {
      console.error('Failed to discard item', deleteError)
      set({ pendingFullDrop: null })
      return
    }

    const { data, error: insertError } = await supabase
      .from('item_instances')
      .insert({ template_id: pending.template.id, owner_id: characterId })
      .select('*')
      .single()

    if (insertError) {
      console.error('Failed to grant item drop', insertError)
      set((state) => ({
        items: state.items.filter((item) => item.id !== discardItemId),
        pendingFullDrop: null,
      }))
      return
    }

    const newItem = data as ItemInstance
    set((state) => ({
      items: [...state.items.filter((item) => item.id !== discardItemId), newItem],
      pendingFullDrop: null,
    }))
  },
}))
