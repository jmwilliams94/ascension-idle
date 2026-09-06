import { create } from 'zustand'
import type { DailyQuestReward } from './useDailyQuestsStore'

// Explicit "what did you just win" reveal for a Daily Quest claim (requested
// by the user, 2026-09-06 — "I don't want any of the quests to silently
// reward and appear in the inventory"). Only ever one claim in flight at a
// time (the modal's Claim buttons are individually busy-guarded), so a
// single current reward is enough — no queue needed, unlike
// useMoneyBagRevealStore (which can have several Lucky Lad draws queued up).
interface DailyQuestRewardState {
  reward: DailyQuestReward | null
  show: (reward: DailyQuestReward) => void
  dismiss: () => void
}

export const useDailyQuestRewardStore = create<DailyQuestRewardState>((set) => ({
  reward: null,
  show: (reward) => set({ reward }),
  dismiss: () => set({ reward: null }),
}))
