import { create } from 'zustand'

// PLACEHOLDER EXP curve — the real leveling formula is unresolved per CLAUDE.md.
// Revisit once real reference data is found. No promotion tiers here yet either;
// level is just a flat incrementing number for now.
export function requiredExpForLevel(level: number): number {
  return Math.round(50 * level ** 1.5)
}

interface ProgressionState {
  level: number
  exp: number
  gold: number
  // The level just reached, shown as a one-off toast by the UI, or null if there's
  // nothing new to show (cleared once the UI has displayed it).
  lastLevelUp: number | null
  addRewards: (gold: number, exp: number) => void
  clearLevelUpNotice: () => void
  // Sets saved values loaded from persistence directly, bypassing the level-up loop
  // and toast in addRewards — this is restoring state, not a gameplay event.
  hydrate: (saved: { level: number; gold: number; exp: number }) => void
}

export const useProgressionStore = create<ProgressionState>((set, get) => ({
  level: 1,
  exp: 0,
  gold: 0,
  lastLevelUp: null,

  addRewards: (goldReward, expReward) => {
    let { level, exp } = get()
    exp += expReward
    let leveledUpTo: number | null = null

    while (exp >= requiredExpForLevel(level)) {
      exp -= requiredExpForLevel(level)
      level += 1
      leveledUpTo = level
    }

    set((state) => ({
      gold: state.gold + goldReward,
      exp,
      level,
      lastLevelUp: leveledUpTo ?? state.lastLevelUp,
    }))
  },

  clearLevelUpNotice: () => set({ lastLevelUp: null }),

  hydrate: (saved) => set({ level: saved.level, gold: saved.gold, exp: saved.exp, lastLevelUp: null }),
}))
