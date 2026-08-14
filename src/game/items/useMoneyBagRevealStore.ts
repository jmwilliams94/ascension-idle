import { create } from 'zustand'
import type { GemTier, GemTypeId } from './gemTypes'

// Drives MoneyBagRevealModal — the center-screen "what did I just open" card
// shown after open_reward_item resolves a Money Bag/Gem Bag (Lucky Lad
// rewards expansion, 2026-08-09), and also (2026-08-21) shown directly from
// a Lucky Lad draw for the instant-grant 'comet_box' reward kind (no
// separate "open" step, unlike Money Bag/Gem Bag).
export type MoneyBagReveal =
  | { kind: 'gold'; amount: number; iconSrc?: string }
  | { kind: 'gem'; gemId: GemTypeId; tier: GemTier }
  | { kind: 'comet_box'; amount: number }

// Queued, not overwritten (fixed 2026-08-20, reported by the user — opening
// several bags in quick succession made the reveal card jitter/move). The
// old `show()` replaced `reveal` directly, so a second bag opened while the
// first card was still on screen changed AnimatePresence's key mid-display:
// framer-motion mounts the new (entering) card before the old (exiting) one
// finishes its exit, and both briefly coexist inside the same flex-centered
// container, each shifting to accommodate the other — the jitter. Now a
// second show() while one is already active just queues instead of
// interrupting it; MoneyBagRevealModal's AnimatePresence onExitComplete
// calls advanceQueue() once the current card has *fully* exited, so at most
// one card is ever mounted at a time.
interface MoneyBagRevealState {
  reveal: MoneyBagReveal | null
  queue: MoneyBagReveal[]
  show: (reveal: MoneyBagReveal) => void
  dismiss: () => void
  advanceQueue: () => void
}

export const useMoneyBagRevealStore = create<MoneyBagRevealState>((set) => ({
  reveal: null,
  queue: [],
  show: (reveal) =>
    set((state) => (state.reveal === null ? { reveal } : { queue: [...state.queue, reveal] })),
  dismiss: () => set({ reveal: null }),
  advanceQueue: () =>
    set((state) => {
      if (state.queue.length === 0) {
        return {}
      }
      const [next, ...rest] = state.queue
      return { reveal: next, queue: rest }
    }),
}))
