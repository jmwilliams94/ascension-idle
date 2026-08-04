import { create } from 'zustand'
import { MAX_CHARACTER_LEVEL, requiredExpForLevel } from './expCurve'

// Re-exported for backward compatibility — moved to expCurve.ts (2026-08-05)
// so combatResolver.ts (a pure, store-free module) can compute monster EXP
// rewards from the same curve without importing this whole Zustand store.
export { MAX_CHARACTER_LEVEL, requiredExpForLevel }

interface ProgressionState {
  level: number
  exp: number
  gold: number
  // Local-only running total from combat log predictions since the last
  // resolve-combat confirmation (see useCombatStore.runTick's kill branch) —
  // added on top of gold/exp for display (ExpBar) so the
  // visible counters move in real time with the log instead of sitting frozen
  // for ~15s and then jumping all at once. Reset to 0 whenever
  // applyServerCombatResult lands, since the confirmed totals already include
  // whatever was predicted (closes a UX gap reported 2026-07-31 — the log
  // text updated instantly, the actual displayed numbers didn't).
  predictedGold: number
  predictedExp: number
  // The level just reached, shown as a one-off toast by the UI, or null if there's
  // nothing new to show (cleared once the UI has displayed it).
  lastLevelUp: number | null
  addRewards: (gold: number, exp: number) => void
  // Accumulates a local prediction only — never itself grants anything real,
  // see the predictedGold/predictedExp field comments.
  addPredictedRewards: (gold: number, exp: number) => void
  clearLevelUpNotice: () => void
  // Sets saved values loaded from persistence directly, bypassing the level-up loop
  // and toast in addRewards — this is restoring state, not a gameplay event.
  hydrate: (saved: { level: number; gold: number; exp: number }) => void
  // Deducts gold for a purchase (e.g. the arrow shop). Returns false and leaves gold
  // untouched if the player can't afford it.
  spendGold: (amount: number) => boolean
  // Direct set, distinct from addRewards/spendGold — reflects transfer_currency's
  // authoritative character_balance (see useBankStore) without touching EXP
  // or the level-up loop.
  setGold: (value: number) => void
  // Reconciles local state with the resolve-combat Edge Function's authoritative
  // response (see resolveCombat.ts) — gold/exp/level are now granted server-side,
  // so this replaces rather than adds. Shows the level-up toast if the server's
  // level is higher than what was already shown.
  applyServerCombatResult: (values: { gold: number; exp: number; level: number }) => void
}

export const useProgressionStore = create<ProgressionState>((set, get) => ({
  level: 1,
  exp: 0,
  gold: 0,
  predictedGold: 0,
  predictedExp: 0,
  lastLevelUp: null,

  addRewards: (goldReward, expReward) => {
    const state = get()
    let { level, exp } = state

    // No Rebirth/Ascension mechanic exists yet to spend banked EXP past the cap
    // on (the user's flagged as a future system, not yet designed) — simplest
    // honest behavior for now is to just stop gaining EXP once maxed, rather
    // than letting it pile up toward nothing.
    if (level < MAX_CHARACTER_LEVEL) {
      exp += expReward
    }

    let leveledUpTo: number | null = null

    while (level < MAX_CHARACTER_LEVEL && exp >= requiredExpForLevel(level)) {
      exp -= requiredExpForLevel(level)
      level += 1
      leveledUpTo = level
    }

    set({
      gold: state.gold + goldReward,
      exp,
      level,
      lastLevelUp: leveledUpTo ?? state.lastLevelUp,
    })
  },

  addPredictedRewards: (gold, exp) => {
    set((state) => ({ predictedGold: state.predictedGold + gold, predictedExp: state.predictedExp + exp }))
  },

  clearLevelUpNotice: () => set({ lastLevelUp: null }),

  hydrate: (saved) =>
    set({ level: saved.level, gold: saved.gold, exp: saved.exp, predictedGold: 0, predictedExp: 0, lastLevelUp: null }),

  spendGold: (amount) => {
    const { gold } = get()

    if (gold < amount) {
      return false
    }

    set({ gold: gold - amount })
    return true
  },

  setGold: (value) => set({ gold: value }),

  applyServerCombatResult: (values) => {
    const previousLevel = get().level
    set({
      gold: values.gold,
      exp: values.exp,
      level: values.level,
      predictedGold: 0,
      predictedExp: 0,
      lastLevelUp: values.level > previousLevel ? values.level : get().lastLevelUp,
    })
  },
}))
