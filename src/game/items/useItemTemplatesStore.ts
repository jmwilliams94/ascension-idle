import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// Mirrors the item_templates table. base_stats is plain jsonb, keyed to match the
// stat names in derivedStats.ts (e.g. "physical_attack") — see equipmentBonus.ts.
// This is the item's Normal-tier baseline only — quality_tier scaling is applied
// dynamically on top via QUALITY_STAT_MULTIPLIERS, not baked into separate rows
// per tier (see computeEquipmentBonus).
export interface ItemTemplate {
  id: string
  name: string
  slot_type: string
  base_stats: Record<string, number>
  // Display/flavor only for now — nothing currently gates equipping on either of
  // these (no level-requirement or class-restriction enforcement exists yet, see
  // buildGearTooltip's "Class: ___" line and CLAUDE.md's Gear slots note).
  required_level: number
  required_class: string | null
  // Groups templates into the same Level Upgrade progression chain (e.g. all 25
  // Bows share 'bow') — distinct from slot_type, since slot_type 'weapon' also
  // holds the standalone "Wooden Sword" freebie, which has no chain of its own.
  // Null/absent means no further upgrade path (mirrors level_upgrade's SQL).
  item_family: string | null
  // Gold cost in the Shop's Weapons/Armor tabs — a placeholder formula (roughly
  // 5x the item's main stat value), unresolved/not tuned like every other
  // economy number in this game.
  price: number
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

    const { data, error } = await supabase
      .from('item_templates')
      .select('id, name, slot_type, base_stats, required_level, required_class, item_family, price')

    if (error) {
      console.error('Failed to load item templates', error)
      return
    }

    set({ templates: (data ?? []) as ItemTemplate[], loaded: true })
  },
}))
