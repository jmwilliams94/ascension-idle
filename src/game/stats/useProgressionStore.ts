import { create } from 'zustand'
import { MAX_CHARACTER_LEVEL, requiredExpForLevel } from './expCurve'

// Re-exported for backward compatibility — moved to expCurve.ts (2026-08-05)
// so combatResolver.ts (a pure, store-free module) can compute monster EXP
// rewards from the same curve without importing this whole Zustand store.
export { MAX_CHARACTER_LEVEL, requiredExpForLevel }

// Deliberate under-prediction margin (2026-08-05, confirmed with the user:
// "can we always have it slightly under predict exp? That way if it ever
// has to make an adjustment it's always an adjustment upwards and never
// downwards"). The client's own tick loop and resolve-combat's server-side
// simulation roll dodge/hit/rare chances independently, so over a short
// window the two can genuinely disagree by a kill or two either way — a
// window where the server resolved slightly *fewer* kills than the client
// predicted would otherwise show the EXP bar visibly drop right when the
// next confirmation lands (see predictedLevel's own comment on this
// already-accepted divergence). Shaving every predicted EXP gain down by
// this factor before it's added builds in enough slack that a confirmation
// almost always corrects upward instead of down. PLACEHOLDER margin, same
// disclosed-not-final status as every other economy number — 5% is a guess
// at "enough slack to absorb normal divergence, not so much it visibly lags
// behind real progress."
const PREDICTED_EXP_SAFETY_FACTOR = 0.95

interface ProgressionState {
  // Confirmed/authoritative — only ever set by applyServerCombatResult,
  // hydrate, or addRewards (the gold-only sell-item path). Everything that
  // needs the character's *real* level for a gameplay effect (attribute
  // auto-allotment, combat's level-diff color/Defense math, Shop/equip level
  // gates) must keep reading this field, not predictedLevel below — only
  // predictedLevel is allowed to run ahead of the server.
  level: number
  exp: number
  gold: number
  // Local-only running total of gold predicted since the last resolve-combat
  // confirmation (see useCombatStore.runTick's kill branch), added on top of
  // gold for display (ExpBar) so the visible counter moves in real time with
  // the log instead of sitting frozen until the next confirmation lands.
  // Reset to 0 whenever applyServerCombatResult lands, since the confirmed
  // total already includes whatever was predicted.
  predictedGold: number
  // Predictive level system (2026-08-05, confirmed with the user — "I
  // dislike the huge delays and no exp reward when something dies").
  // Previously predictedExp was just added on top of the confirmed exp for
  // display, clamped at 100% of the *current confirmed* level's requirement
  // — so once a player got close to leveling, the bar visually capped out
  // and just sat there (reading as "no reward") until the next resolve-
  // combat confirmation actually crossed the threshold, up to
  // RESOLVE_INTERVAL_MS (see CombatEngine.tsx) later. predictedLevel/
  // predictedExp now roll over locally using the exact same level-up loop
  // addRewards uses below (just against these fields instead of the
  // confirmed level/exp), so the bar keeps climbing — and a "Level up!"
  // toast fires — immediately, well before the server confirms it. This is
  // display-only prediction, same trust tier as predictedGold: nothing here
  // is itself authoritative, and applyServerCombatResult always resyncs both
  // fields to the server's real values once it lands (which can occasionally
  // mean predictedLevel visibly steps back down a notch if the server's own
  // independent RNG/kill-timing simulated slightly fewer kills than the
  // client predicted — the same already-accepted divergence risk
  // predictedGold/predictedExp already had, just now also affecting the
  // level number, not only the numbers within it). See
  // PREDICTED_EXP_SAFETY_FACTOR below for how addPredictedRewards guards
  // against this specifically for EXP — gold has no equivalent margin.
  predictedLevel: number
  predictedExp: number
  // The level just reached, shown as a one-off toast by the UI, or null if there's
  // nothing new to show (cleared once the UI has displayed it).
  lastLevelUp: number | null
  // Highest level a toast has already been shown for, predictively or
  // confirmed — prevents applyServerCombatResult from re-firing a toast for
  // a level-up addPredictedRewards already announced a few seconds earlier,
  // and prevents addPredictedRewards from re-announcing one after a
  // predictedLevel rollback (see predictedLevel's own comment) re-crosses
  // the same threshold a second time.
  lastLevelUpNotified: number
  addRewards: (gold: number, exp: number) => void
  // Accumulates a local prediction only — never itself grants anything real,
  // see the predictedGold/predictedLevel/predictedExp field comments.
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
  // so this replaces rather than adds. Also resyncs predictedLevel/predictedExp
  // back to this real level/exp (see their own comments) and shows the level-up
  // toast if the server's level is higher than what was already shown (skipped
  // if the predictive path already announced this exact level-up itself).
  applyServerCombatResult: (values: { gold: number; exp: number; level: number }) => void
}

export const useProgressionStore = create<ProgressionState>((set, get) => ({
  level: 1,
  exp: 0,
  gold: 0,
  predictedGold: 0,
  predictedLevel: 1,
  predictedExp: 0,
  lastLevelUp: null,
  lastLevelUpNotified: 1,

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
    set((state) => {
      let level = state.predictedLevel
      let expInLevel = state.predictedExp

      if (level < MAX_CHARACTER_LEVEL) {
        expInLevel += Math.floor(exp * PREDICTED_EXP_SAFETY_FACTOR)
      }

      let leveledUpTo: number | null = null

      while (level < MAX_CHARACTER_LEVEL && expInLevel >= requiredExpForLevel(level)) {
        expInLevel -= requiredExpForLevel(level)
        level += 1
        leveledUpTo = level
      }

      const showToast = leveledUpTo !== null && leveledUpTo > state.lastLevelUpNotified

      return {
        predictedGold: state.predictedGold + gold,
        predictedLevel: level,
        predictedExp: expInLevel,
        lastLevelUp: showToast ? leveledUpTo : state.lastLevelUp,
        lastLevelUpNotified: showToast ? (leveledUpTo as number) : state.lastLevelUpNotified,
      }
    })
  },

  clearLevelUpNotice: () => set({ lastLevelUp: null }),

  hydrate: (saved) =>
    set({
      level: saved.level,
      gold: saved.gold,
      exp: saved.exp,
      predictedGold: 0,
      predictedLevel: saved.level,
      // Bug fix (2026-08-05): this was 0, not saved.exp — predictedExp is the
      // sole source ExpBar reads for the fraction/bar-fill display now (see
      // predictedLevel's own comment), not something added on top of a
      // separately-displayed confirmed exp the way predictedGold still is.
      // Resetting it to 0 here (and in applyServerCombatResult below) meant
      // the bar visibly dropped to 0 and had to reclimb from scratch on
      // every load/confirmation, reported by the user as EXP "flicking back
      // to 0" every few seconds.
      predictedExp: saved.exp,
      lastLevelUp: null,
      lastLevelUpNotified: saved.level,
    }),

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
    const state = get()
    const alreadyNotified = state.lastLevelUpNotified >= values.level
    const showToast = values.level > state.level && !alreadyNotified

    set({
      gold: values.gold,
      exp: values.exp,
      level: values.level,
      predictedGold: 0,
      predictedLevel: values.level,
      // Bug fix (2026-08-05) — see hydrate's own comment: this was 0, not
      // values.exp, dropping the visible bar to 0 on every confirmation
      // (every RESOLVE_INTERVAL_MS while fighting) before it climbed back up
      // from scratch as new predicted kills came in — a real regression from
      // the predictive-leveling change, not a pre-existing issue.
      predictedExp: values.exp,
      lastLevelUp: showToast ? values.level : state.lastLevelUp,
      lastLevelUpNotified: Math.max(state.lastLevelUpNotified, values.level),
    })
  },
}))
