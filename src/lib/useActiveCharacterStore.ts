import { create } from 'zustand'
import { useMiningStore } from '../game/mining/useMiningStore'
import { useCombatStore } from '../game/combat/useCombatStore'

// Which character (if any) the current session is playing as.
interface ActiveCharacterState {
  characterId: string | null
  setActiveCharacterId: (characterId: string | null) => void
}

export const useActiveCharacterStore = create<ActiveCharacterState>((set) => ({
  characterId: null,
  setActiveCharacterId: (characterId) => {
    // CombatEngine/MiningEngine are mounted unconditionally in GameShell and
    // read useCombatStore.isFighting / useMiningStore.isMining fresh on every
    // tick, keyed off whichever characterId is active *right now* — but
    // those two flags are global module state, never reset just because
    // GameShell unmounts (Switch Character routes through here with
    // characterId=null) or remounts for a different character afterward.
    // Without stopping them here, a mode left running on the OUTGOING
    // character keeps ticking — now against whichever character this call
    // switches TO — for the entire window until GameShell's own async load
    // effect gets around to its much-later stop-the-other-mode safeguard
    // (only after a full character/inventory load round trip), and a live
    // resolve firing in that window grants that character rewards for an
    // activity it never actually started. Reported by the user: switching
    // away from a character left on Mining caused the character just
    // switched TO to have its Inventory rapidly fill with Ore it never
    // mined. Stopping here — before the id itself changes — also lets
    // CombatEngine/MiningEngine's own isFighting/isMining subscriptions fire
    // one last resolve for the OUTGOING character while it's still active,
    // properly closing out its last few live seconds instead of leaving
    // them stranded until the next unrelated trigger.
    useCombatStore.getState().stop()
    useMiningStore.getState().stop()
    set({ characterId })
  },
}))

// Last-played character per account, so a page refresh resumes where you left off
// instead of always landing back on character select. Keyed by account id (not a
// single fixed key) so switching accounts on a shared browser can't leak one
// account's selection into another's. Plain localStorage rather than zustand's
// persist middleware since the storage key itself needs to vary per account at
// runtime. See App.tsx for how this is read on mount and kept in sync.
const STORAGE_KEY_PREFIX = 'ascension-last-character:'

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
