import { create } from 'zustand'

// Real level cap, confirmed by the user (2026-07-30) alongside the EXP curve
// below — matches the gear system's own 130 weapon-level cap (see CLAUDE.md).
export const MAX_CHARACTER_LEVEL = 130

// Real Conquer Online EXP-curve reference data (confirmed 2026-07-30) — the
// per-level EXP required to advance from that level to the next, at a handful
// of confirmed anchor levels (total EXP to reach 130 from level 1 sums to
// ~13.4 billion, matching the source). Levels between anchors don't have
// confirmed numbers, so they're geometrically interpolated (proportional on a
// log scale between the two nearest anchors) rather than guessed — an honest
// curve through real data beats inventing a smooth formula that doesn't
// actually match any of the confirmed points. The steep jump from level 109 to
// 110 lines up with a promotion-tier boundary (see the Promotion tiers note in
// CLAUDE.md), not a data error. Levels 128-130 plateau at the same value,
// matching the source noting 130's requirement is identical to 128's.
const EXP_CURVE_ANCHORS: [level: number, required: number][] = [
  [1, 39],
  [20, 68_789],
  [21, 70_451],
  [80, 15_896_985],
  [81, 16_163_738],
  [109, 193_716_061],
  [110, 408_832_135],
  [127, 1_011_439_064],
  [128, 1_073_741_808],
  [MAX_CHARACTER_LEVEL, 1_073_741_808],
]

export function requiredExpForLevel(level: number): number {
  const clampedLevel = Math.min(Math.max(level, 1), MAX_CHARACTER_LEVEL)

  for (let i = 0; i < EXP_CURVE_ANCHORS.length; i += 1) {
    const [anchorLevel, anchorValue] = EXP_CURVE_ANCHORS[i]

    if (clampedLevel === anchorLevel) {
      return anchorValue
    }

    if (clampedLevel < anchorLevel) {
      const [prevLevel, prevValue] = EXP_CURVE_ANCHORS[i - 1]
      const t = (clampedLevel - prevLevel) / (anchorLevel - prevLevel)
      return Math.round(prevValue * (anchorValue / prevValue) ** t)
    }
  }

  return EXP_CURVE_ANCHORS[EXP_CURVE_ANCHORS.length - 1][1]
}

interface ProgressionState {
  level: number
  exp: number
  gold: number
  // Local-only running total from combat log predictions since the last
  // resolve-combat confirmation (see useCombatStore.runTick's kill branch) —
  // added on top of gold/exp for display (ExpBar/ProgressionPanel) so the
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
  // authoritative character_balance (see useWarehouseStore) without touching EXP
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
