import { create } from 'zustand'
import type { GemTypeId } from '../items/gemCatalog'
import { PICKAXE_ATTACK_BY_TIER, PICKAXE_TIER_ORDER, type PickaxeTierName } from './pickaxeCosts'

// Client-side mirror of the character's single Pickaxe item — hydrated from
// the same character-record load that hydrates equipment/gems (see
// useCharacterRecordStore.ts). Unlike regular gear, there's only ever one
// Pickaxe per character and it's never swapped, only advanced in place
// server-side, so this is a flat snapshot rather than an item_instances-
// shaped record.
interface PickaxeState {
  itemId: string | null
  tierName: PickaxeTierName
  compositionLevel: number
  ascendedGemType: GemTypeId | null
  hydrate: (data: {
    itemId: string | null
    tierName: string | null
    compositionLevel: number
    ascendedGemType: string | null
  }) => void
  applyTierUpgrade: (tierName: PickaxeTierName) => void
}

function resolveTierName(saved: string | null): PickaxeTierName {
  return (PICKAXE_TIER_ORDER as readonly string[]).includes(saved ?? '') ? (saved as PickaxeTierName) : 'Pickaxe'
}

export const usePickaxeStore = create<PickaxeState>((set) => ({
  itemId: null,
  tierName: 'Pickaxe',
  compositionLevel: 0,
  ascendedGemType: null,
  hydrate: (data) =>
    set({
      itemId: data.itemId,
      tierName: resolveTierName(data.tierName),
      compositionLevel: data.compositionLevel,
      ascendedGemType: (data.ascendedGemType as GemTypeId | null) ?? null,
    }),
  applyTierUpgrade: (tierName) => set({ tierName }),
}))

export function currentPickaxeBaseAttack(tierName: PickaxeTierName): number {
  return PICKAXE_ATTACK_BY_TIER[tierName] ?? PICKAXE_ATTACK_BY_TIER.Pickaxe
}
