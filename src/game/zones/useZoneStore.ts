import { create } from 'zustand'
import { ZONE_NAME } from './twincrossOutskirts'

// Only one zone exists right now, so this is inert in practice — but current_zone is
// a real persisted column (see the players table migration), so this is here for
// when zone travel actually exists rather than needing another restructuring pass.
interface ZoneState {
  currentZoneName: string
  setCurrentZoneName: (name: string) => void
}

export const useZoneStore = create<ZoneState>((set) => ({
  currentZoneName: ZONE_NAME,
  setCurrentZoneName: (name) => set({ currentZoneName: name }),
}))
