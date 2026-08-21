import { create } from 'zustand'
import { MINES, type MineId } from './mineData'

const KNOWN_MINE_IDS = new Set<string>(Object.keys(MINES))

function resolveMineId(saved: string | null): MineId | null {
  if (saved && KNOWN_MINE_IDS.has(saved)) {
    return saved as MineId
  }
  return null
}

interface MineState {
  // null means "no mine selected yet" (a fresh character, or one that's
  // never opened Mining) — mirrors useZoneStore's selectedMonsterId. Unlike
  // Hunting's zone/monster split, a mine has exactly one node, so selecting
  // a mine doubles as node selection — no separate "selected node" state.
  currentMineId: MineId | null
  setCurrentMineId: (id: MineId) => void
  hydrate: (saved: { mineId: string | null }) => void
}

export const useMineStore = create<MineState>((set) => ({
  currentMineId: null,
  setCurrentMineId: (id) => set({ currentMineId: id }),
  hydrate: (saved) => set({ currentMineId: resolveMineId(saved.mineId) }),
}))
