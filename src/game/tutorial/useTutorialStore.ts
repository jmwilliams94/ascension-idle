import { create } from 'zustand'
import { TUTORIAL_STEPS } from './tutorialSteps'

// First-login tutorial state machine (admin-only for now — see CLAUDE.md).
// Deliberately dumb: just an index into the static TUTORIAL_STEPS list. Real
// UI components (TabNav/LuckyPanel/ForgeHub/ForgeStandardPanel/
// ForgeSocketsTab) call isStepActive(id) themselves to decide whether to
// branch into a tutorial-guaranteed RPC and/or call advance() once their own
// real action actually completes — this store never reaches into any other
// store itself.
interface TutorialState {
  active: boolean
  characterId: string | null
  stepIndex: number
  startForCharacter: (characterId: string) => void
  advance: () => void
  skip: () => void
  isStepActive: (id: string) => boolean
}

export const useTutorialStore = create<TutorialState>((set, get) => ({
  active: false,
  characterId: null,
  stepIndex: 0,

  startForCharacter: (characterId) => set({ active: true, characterId, stepIndex: 0 }),

  advance: () =>
    set((state) => {
      const nextIndex = state.stepIndex + 1
      return nextIndex >= TUTORIAL_STEPS.length ? { active: false } : { stepIndex: nextIndex }
    }),

  skip: () => set({ active: false }),

  isStepActive: (id) => {
    const state = get()
    return state.active && TUTORIAL_STEPS[state.stepIndex]?.id === id
  },
}))
