import { create } from 'zustand'
import type { EnemyTypeId } from './twincrossOutskirts'

// Only one zone exists right now. ZoneId is its own type (not just a display
// string) so a real zone-picker can exist once a second zone does, without another
// restructuring pass.
export type ZoneId = 'twincross-outskirts'

const KNOWN_ZONE_ID: ZoneId = 'twincross-outskirts'
const KNOWN_MONSTER_IDS: readonly string[] = ['mudrat', 'brushfowl', 'fernvale-dove']

// current_zone used to store this zone's display name ("Twincross Outskirts");
// going forward it stores this stable id instead. Any unrecognized/legacy value
// (including that old display-name default) falls back to the one known zone —
// there's nothing else to resolve to yet, and no backfill migration is needed for
// a single-zone game. Takes no argument today since there's nothing to actually
// resolve against — once a second zone exists, this starts inspecting the saved
// value instead of ignoring it.
function resolveZoneId(): ZoneId {
  return KNOWN_ZONE_ID
}

function resolveMonsterId(saved: string | null): EnemyTypeId | null {
  if (saved && KNOWN_MONSTER_IDS.includes(saved)) {
    return saved as EnemyTypeId
  }
  return null
}

interface ZoneState {
  currentZoneId: ZoneId
  // Which monster the player has picked to fight continuously — null means they
  // haven't chosen one yet (a fresh character, or one that never engaged combat).
  // This is also what the offline-progress simulator resumes against.
  selectedMonsterId: EnemyTypeId | null
  setCurrentZoneId: (id: ZoneId) => void
  setSelectedMonsterId: (id: EnemyTypeId | null) => void
  hydrate: (saved: { zoneId: string; monsterId: string | null }) => void
}

export const useZoneStore = create<ZoneState>((set) => ({
  currentZoneId: KNOWN_ZONE_ID,
  selectedMonsterId: null,
  setCurrentZoneId: (id) => set({ currentZoneId: id }),
  setSelectedMonsterId: (id) => set({ selectedMonsterId: id }),
  hydrate: (saved) =>
    set({
      currentZoneId: resolveZoneId(),
      selectedMonsterId: resolveMonsterId(saved.monsterId),
    }),
}))
