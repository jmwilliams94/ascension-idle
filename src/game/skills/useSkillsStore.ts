import { create } from 'zustand'
import { SKILL_TYPES, type SkillId } from './skillData'

const KNOWN_SKILL_IDS = new Set<string>(Object.keys(SKILL_TYPES))

function resolveSkillId(saved: string | null): SkillId | null {
  if (saved && KNOWN_SKILL_IDS.has(saved)) {
    return saved as SkillId
  }
  return null
}

// Mirrors useMineStore/useZoneStore's shape — plain client-writable state,
// persisted via useCharacterRecordStore's saveNow (characters.equipped_skill_id)
// and re-validated (class match) wherever it's actually applied to combat
// math, never trusted at the write site. Exactly one skill can be equipped
// at a time, matching "replaces the regular attack" rather than stacking.
interface SkillsState {
  equippedSkillId: SkillId | null
  equipSkill: (id: SkillId) => void
  unequipSkill: () => void
  hydrate: (saved: { skillId: string | null }) => void
}

export const useSkillsStore = create<SkillsState>((set) => ({
  equippedSkillId: null,
  equipSkill: (id) => set({ equippedSkillId: id }),
  unequipSkill: () => set({ equippedSkillId: null }),
  hydrate: (saved) => set({ equippedSkillId: resolveSkillId(saved.skillId) }),
}))
