import { create } from 'zustand'
import { getAttributesForLevel, type Attributes, type ClassId } from './classes'
import { useProgressionStore } from './useProgressionStore'

interface CharacterState {
  selectedClassId: ClassId
  attributes: Attributes
  selectClass: (classId: ClassId) => void
}

export const useCharacterStore = create<CharacterState>((set) => ({
  selectedClassId: 'hunter',
  attributes: getAttributesForLevel('hunter', useProgressionStore.getState().level),
  selectClass: (classId) =>
    set({
      selectedClassId: classId,
      attributes: getAttributesForLevel(classId, useProgressionStore.getState().level),
    }),
}))

// Attributes are a pure function of (class, level) now (see classes.ts's
// getAttributesForLevel — auto-allotment, confirmed with the user, 2026-08-
// 02) rather than a value set once at class selection and left alone.
// Cross-store subscription keeps them in sync whenever level changes for any
// reason — addRewards (live level-up), applyServerCombatResult (server
// reconciliation), or hydrate (loading a saved character) all just call
// useProgressionStore's own set() under the hood, so this one subscription
// covers every path without each of those call sites needing to know about
// attributes at all.
useProgressionStore.subscribe((state, previousState) => {
  if (state.level !== previousState.level) {
    useCharacterStore.setState({
      attributes: getAttributesForLevel(useCharacterStore.getState().selectedClassId, state.level),
    })
  }
})
