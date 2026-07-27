import { create } from 'zustand'

// Meteors (Level Upgrade) and DragonBalls (Quality Upgrade + weapon sockets later),
// per CLAUDE.md. Deliberately NOT wired into usePersistGameState's autosave: the
// quality_upgrade/level_upgrade Postgres functions already deduct these server-side
// as part of the same transaction as the item write, so the client only ever reads
// them (on load, and from each RPC call's response) — it must never write them back
// via the generic player-update autosave, or a stale local value could clobber a
// server-side deduction that happened moments earlier.
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
