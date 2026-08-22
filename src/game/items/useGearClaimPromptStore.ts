import { create } from 'zustand'
import type { ScoredSlot } from './useGearSnapshotStore'

// Backs GearSnapshotClaimModal.tsx — shown when claim_gear_snapshot refuses
// with 'already_claimed' (see InventoryPanel.tsx's handleEquip). The equip
// itself already happened by the time this shows; this only decides whether
// the Gear Score credit transfers to the new character.
export interface PendingGearClaim {
  characterId: string
  slot: ScoredSlot
  itemId: string
  claimedByCharacterName: string
}

interface GearClaimPromptState {
  pending: PendingGearClaim | null
  show: (pending: PendingGearClaim) => void
  clear: () => void
}

export const useGearClaimPromptStore = create<GearClaimPromptState>((set) => ({
  pending: null,
  show: (pending) => set({ pending }),
  clear: () => set({ pending: null }),
}))
