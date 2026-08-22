import { create } from 'zustand'
import type { GemTypeId } from '../items/gemCatalog'
import { PICKAXE_ATTACK_BY_TIER, PICKAXE_TIER_ORDER, type PickaxeTierName } from './pickaxeCosts'

// Client-side mirror of the character's single Pickaxe item — hydrated from
// the same character-record load that hydrates equipment/gems (see
// useCharacterRecordStore.ts). Unlike regular gear, there's only ever one
// Pickaxe per character and it's never swapped for a different one, only
// advanced in place server-side, so this is a flat snapshot rather than an
// item_instances-shaped record.
//
// itemId vs equipped (2026-08-22, requested by the user — "make Pickaxe
// require being equipped to mine, unequipping stops it") — previously a
// Pickaxe was equipped the instant it was bought and never unequipped
// again, so "owned" and "equipped" were the same thing and itemId alone was
// enough. Now they can genuinely diverge (equip_pickaxe/unequip_pickaxe),
// so itemId tracks ownership (needed for Tier Up, which works either way,
// same as normal gear's Forge actions don't require the item to be worn)
// while `equipped` tracks the actual gate Mining checks.
interface PickaxeState {
  itemId: string | null
  equipped: boolean
  tierName: PickaxeTierName
  compositionLevel: number
  ascendedGemType: GemTypeId | null
  hydrate: (data: {
    itemId: string | null
    equipped: boolean
    tierName: string | null
    compositionLevel: number
    ascendedGemType: string | null
  }) => void
  // ascendedGemType is only passed when pickaxe_tier_upgrade's response
  // actually rolled one (reaching Ascended for the first time) — omitted
  // (undefined) leaves the existing value alone on every other tier-up.
  applyTierUpgrade: (tierName: PickaxeTierName, ascendedGemType?: GemTypeId | null) => void
  setEquipped: (equipped: boolean) => void
}

function resolveTierName(saved: string | null): PickaxeTierName {
  return (PICKAXE_TIER_ORDER as readonly string[]).includes(saved ?? '') ? (saved as PickaxeTierName) : 'Pickaxe'
}

export const usePickaxeStore = create<PickaxeState>((set) => ({
  itemId: null,
  equipped: false,
  tierName: 'Pickaxe',
  compositionLevel: 0,
  ascendedGemType: null,
  hydrate: (data) =>
    set({
      itemId: data.itemId,
      equipped: data.equipped,
      tierName: resolveTierName(data.tierName),
      compositionLevel: data.compositionLevel,
      ascendedGemType: (data.ascendedGemType as GemTypeId | null) ?? null,
    }),
  applyTierUpgrade: (tierName, ascendedGemType) =>
    set((s) => ({ tierName, ascendedGemType: ascendedGemType !== undefined ? ascendedGemType : s.ascendedGemType })),
  setEquipped: (equipped) => set({ equipped }),
}))

export function currentPickaxeBaseAttack(tierName: PickaxeTierName): number {
  return PICKAXE_ATTACK_BY_TIER[tierName] ?? PICKAXE_ATTACK_BY_TIER.Pickaxe
}
