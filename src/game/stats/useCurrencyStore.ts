import { create } from 'zustand'

// Meteors (Level Upgrade) and DragonBalls (Quality Upgrade + weapon sockets later),
// per CLAUDE.md. Deliberately NOT wired into usePersistGameState's autosave: the
// quality_upgrade/level_upgrade Postgres functions and the resolve-combat Edge
// Function already mutate these server-side, so the client only ever reads them
// (on load, and from each call's response) — it must never write them back via
// the generic player-update autosave, or a stale local value could clobber a
// server-side change that happened moments earlier.
//
// Superseded: kill-drop grants used to go through a dedicated grant_currency_reward
// RPC (an atomic increment, called directly from useCombatStore's kill branch).
// That RPC still exists but is no longer called from the client — Meteor/
// DragonBall kill-drops are now resolved as part of resolve-combat's own
// transaction (see resolveCombat.ts), alongside gold/EXP/item drops, rather than
// as a separate call.
interface CurrencyState {
  meteors: number
  dragonballs: number
  hydrate: (saved: { meteors: number; dragonballs: number }) => void
  setMeteors: (value: number) => void
  setDragonballs: (value: number) => void
}

export const useCurrencyStore = create<CurrencyState>((set) => ({
  meteors: 0,
  dragonballs: 0,
  hydrate: (saved) => set({ meteors: saved.meteors, dragonballs: saved.dragonballs }),
  setMeteors: (value) => set({ meteors: value }),
  setDragonballs: (value) => set({ dragonballs: value }),
}))
