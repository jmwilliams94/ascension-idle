import { create } from 'zustand'
import { MAX_CHARACTER_LEVEL, requiredExpForLevel } from './expCurve'

// Re-exported for backward compatibility — moved to expCurve.ts (2026-08-05)
// so combatResolver.ts (a pure, store-free module) can compute monster EXP
// rewards from the same curve without importing this whole Zustand store.
export { MAX_CHARACTER_LEVEL, requiredExpForLevel }

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
  // predictedLevel/predictedExp: display-only mirrors of level/exp, only
  // ever set by applyServerCombatResult/hydrate. Originally a genuine
  // per-attack prediction (2026-08-05, "I dislike the huge delays and no exp
  // reward when something dies") that ran ahead of the server for a smooth,
  // immediately-climbing EXP bar. Retired as *prediction* in the 2026-11
  // reward-on-kill rewrite (requested by the user, reversing that decision —
  // see useCombatStore.runTick's own comment) — nothing advances these
  // fields ahead of a real server confirmation anymore, so they now just
  // hold the last confirmed value, same as `level`/`exp`. Kept as separate
  // fields rather than merged back into them since ExpBar.tsx/
  // LevelUpBanner.tsx already read these specifically and merging would be a
  // larger, unnecessary change. predictedGold (the equivalent field for
  // gold) was removed outright instead — ExpBar.tsx now just reads `gold`
  // directly.
  predictedLevel: number
  predictedExp: number
  // The level just reached, shown as a one-off toast by the UI, or null if there's
  // nothing new to show (cleared once the UI has displayed it).
  lastLevelUp: number | null
  // Highest level a toast has already been shown for — prevents
  // applyServerCombatResult from re-firing a toast for a level-up already
  // shown.
  lastLevelUpNotified: number
  addRewards: (gold: number, exp: number) => void
  clearLevelUpNotice: () => void
  // Sets saved values loaded from persistence directly, bypassing the level-up loop
  // and toast in addRewards — this is restoring state, not a gameplay event.
  hydrate: (saved: { level: number; gold: number; exp: number }) => void
  // Direct set, distinct from addRewards/applyGoldDelta — reflects transfer_currency's
  // authoritative character_balance (see useBankStore) without touching EXP
  // or the level-up loop.
  setGold: (value: number) => void
  // Delta-style gold change (2026-08-14, Repair All — see useRepairStore) —
  // deliberately not setGold's absolute overwrite, since CombatEngine polls
  // resolve-combat in the background regardless of which tab is open, so a
  // Repair All can genuinely land mid-combat-resolve. Same "add a delta, never
  // stomp a concurrent gain" reasoning as applyServerCombatResult's own
  // goldGained handling below.
  applyGoldDelta: (amount: number) => void
  // Reconciles local state with the resolve-combat Edge Function's authoritative
  // response (see resolveCombat.ts) — exp/level are granted server-side, so
  // those two replace rather than add. gold is intentionally NOT replaced the
  // same way (see goldGained's own comment below) — it's added as a delta
  // instead. Also resyncs predictedLevel/predictedExp back to this real
  // level/exp (see their own comments) and shows the level-up toast if the
  // server's level is higher than what was already shown (skipped if the
  // predictive path already announced this exact level-up itself).
  applyServerCombatResult: (values: { goldGained: number; exp: number; level: number }) => void
}

export const useProgressionStore = create<ProgressionState>((set, get) => ({
  level: 1,
  exp: 0,
  gold: 0,
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

  clearLevelUpNotice: () => set({ lastLevelUp: null }),

  hydrate: (saved) =>
    set({
      level: saved.level,
      gold: saved.gold,
      exp: saved.exp,
      predictedLevel: saved.level,
      // Bug fix (2026-08-05): this was 0, not saved.exp — predictedExp is the
      // sole source ExpBar reads for the fraction/bar-fill display now (see
      // predictedLevel's own comment). Resetting it to 0 here (and in
      // applyServerCombatResult below) meant
      // the bar visibly dropped to 0 and had to reclimb from scratch on
      // every load/confirmation, reported by the user as EXP "flicking back
      // to 0" every few seconds.
      predictedExp: saved.exp,
      lastLevelUp: null,
      lastLevelUpNotified: saved.level,
    }),

  setGold: (value) => set({ gold: value }),

  applyGoldDelta: (amount) => set((state) => ({ gold: state.gold + amount })),

  applyServerCombatResult: (values) => {
    const state = get()
    const alreadyNotified = state.lastLevelUpNotified >= values.level
    const showToast = values.level > state.level && !alreadyNotified

    // goldGained is applied as a delta, not an absolute overwrite (fixed
    // 2026-08-13, reported by the user: "used a money bag, saw my gold go
    // up, then saw it reverse back to what it was"). resolve-combat only
    // runs every few seconds while fighting, so its response can land after
    // some other gold-granting action (Money Bag/sell/salvage/Bank
    // withdraw/Lucky Lad) has already applied its own gain on top of local
    // gold — an absolute `gold: values.gold` would then stomp that gain back
    // to whatever gold looked like when resolve-combat's snapshot was taken
    // (in the worst case, a stale no-op window with gold unchanged, exactly
    // erasing the money bag's addition). gold is granted by several
    // independent RPCs this way, unlike exp/level which only resolve-combat
    // ever writes — those stay a safe absolute set.
    set({
      gold: state.gold + values.goldGained,
      exp: values.exp,
      level: values.level,
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
