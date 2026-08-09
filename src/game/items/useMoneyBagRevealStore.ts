import { create } from 'zustand'
import type { GemTier, GemTypeId } from './gemTypes'

// Drives MoneyBagRevealModal — the center-screen "what did I just open" card
// shown after open_reward_item resolves a Money Bag/Gem Bag (Lucky Lad
// rewards expansion, 2026-08-09). Deliberately no auto-dismiss timeout,
// unlike PetToast — this is a genuine reveal moment the player should
// explicitly close (same reasoning as OfflineProgressModal's "Got it"
// button), not a passive notification that can be missed.
export type MoneyBagReveal =
  | { kind: 'gold'; amount: number; iconSrc?: string }
  | { kind: 'gem'; gemId: GemTypeId; tier: GemTier }

interface MoneyBagRevealState {
  reveal: MoneyBagReveal | null
  show: (reveal: MoneyBagReveal) => void
  dismiss: () => void
}

export const useMoneyBagRevealStore = create<MoneyBagRevealState>((set) => ({
  reveal: null,
  show: (reveal) => set({ reveal }),
  dismiss: () => set({ reveal: null }),
}))
