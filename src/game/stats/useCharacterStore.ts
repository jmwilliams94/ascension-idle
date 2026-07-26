import { create } from 'zustand'
import { CLASS_DEFINITIONS, type Attributes, type ClassId } from './classes'

interface CharacterState {
  selectedClassId: ClassId
  attributes: Attributes
  selectClass: (classId: ClassId) => void
}

export const useCharacterStore = create<CharacterState>((set) => ({
  selectedClassId: 'hunter',
  attributes: { ...CLASS_DEFINITIONS.hunter.baseAttributes },
  selectClass: (classId) =>
    set({
      selectedClassId: classId,
      attributes: { ...CLASS_DEFINITIONS[classId].baseAttributes },
    }),
}))
