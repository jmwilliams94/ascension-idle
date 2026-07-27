import { create } from 'zustand'

// Which character (if any) the current session is playing as. In-memory only —
// a page refresh currently returns to character select rather than remembering the
// last-played character; that's a reasonable follow-up if it turns out to be
// annoying, not something this step was asked to solve.
interface ActiveCharacterState {
  characterId: string | null
  setActiveCharacterId: (characterId: string | null) => void
}

export const useActiveCharacterStore = create<ActiveCharacterState>((set) => ({
  characterId: null,
  setActiveCharacterId: (characterId) => set({ characterId }),
}))
