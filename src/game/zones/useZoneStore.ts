import { create } from 'zustand'
import { DEFAULT_ZONE_ID, ENEMY_TYPES, ZONES, type EnemyTypeId, type ZoneId } from './zoneData'

const KNOWN_ZONE_IDS = new Set<string>(Object.keys(ZONES))
const KNOWN_MONSTER_IDS = new Set<string>(Object.keys(ENEMY_TYPES))

// current_zone used to store either the old placeholder zone's display name
// ("Twincross Outskirts") or its id ("twincross-outskirts") before the
// multi-zone rebuild — neither is a real ZoneId anymore, so any unrecognized
// value falls back to the default zone rather than erroring.
function resolveZoneId(saved: string): ZoneId {
  return KNOWN_ZONE_IDS.has(saved) ? (saved as ZoneId) : DEFAULT_ZONE_ID
}

// Old placeholder monster ids ('mudrat'/'brushfowl'/'fernvale-dove') no longer
// exist at all post-rebuild — same fallback treatment, resolves to "nothing
// selected yet" rather than crashing on a stale id.
function resolveMonsterId(saved: string | null): EnemyTypeId | null {
  if (saved && KNOWN_MONSTER_IDS.has(saved)) {
    return saved as EnemyTypeId
  }
  return null
}

interface ZoneState {
  currentZoneId: ZoneId
  // Which monster the player has picked to fight continuously — null means they
  // haven't chosen one yet (a fresh character, one that never engaged combat, or
  // one that just switched zones). This is also what the offline-progress
  // simulator resumes against.
  selectedMonsterId: EnemyTypeId | null
  // Switching zones always clears the monster selection — a monster id only
  // makes sense within the zone it was picked from, so there's no valid "carry
  // it over" behavior; the player picks a fresh monster from the new zone's
  // roster (see CombatPage, which also stops any active fight on zone switch).
  setCurrentZoneId: (id: ZoneId) => void
  setSelectedMonsterId: (id: EnemyTypeId | null) => void
  hydrate: (saved: { zoneId: string; monsterId: string | null }) => void
}

export const useZoneStore = create<ZoneState>((set) => ({
  currentZoneId: DEFAULT_ZONE_ID,
  selectedMonsterId: null,
  setCurrentZoneId: (id) => set({ currentZoneId: id, selectedMonsterId: null }),
  setSelectedMonsterId: (id) => set({ selectedMonsterId: id }),
  hydrate: (saved) =>
    set({
      currentZoneId: resolveZoneId(saved.zoneId),
      selectedMonsterId: resolveMonsterId(saved.monsterId),
    }),
}))
