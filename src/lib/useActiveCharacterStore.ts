import { create } from 'zustand'

// Which character (if any) the current session is playing as.
interface ActiveCharacterState {
  characterId: string | null
  setActiveCharacterId: (characterId: string | null) => void
}

export const useActiveCharacterStore = create<ActiveCharacterState>((set) => ({
  characterId: null,
  setActiveCharacterId: (characterId) => set({ characterId }),
}))

// Last-played character per account, so a page refresh resumes where you left off
// instead of always landing back on character select. Keyed by account id (not a
// single fixed key) so switching accounts on a shared browser can't leak one
// account's selection into another's. Plain localStorage rather than zustand's
// persist middleware since the storage key itself needs to vary per account at
// runtime. See App.tsx for how this is read on mount and kept in sync.
const STORAGE_KEY_PREFIX = 'greybox-last-character:'

export function getStoredCharacterId(accountId: string): string | null {
  try {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${accountId}`)
  } catch {
    return null
  }
}

export function setStoredCharacterId(accountId: string, characterId: string | null): void {
  try {
    if (characterId) {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${accountId}`, characterId)
    } else {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${accountId}`)
    }
  } catch {
    // localStorage can throw (privacy mode, quota, etc.) — not worth failing the
    // app over, this is just a convenience, not required for correctness.
  }
}
