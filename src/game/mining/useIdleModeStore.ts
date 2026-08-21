import { create } from 'zustand'

// Hunting and Mining can never both be active — including AFK/offline
// accrual, not just live play (confirmed by the user). This tracks which one
// the player last activated (pressing Fight or Mine), so login-time offline
// catch-up knows which single mode's window to resolve rather than trying
// both and double-granting. Persisted via characters.last_active_idle_mode
// (see useCharacterRecordStore.ts's saveNow/hydrate).
export type IdleMode = 'hunting' | 'mining'

interface IdleModeState {
  lastActiveIdleMode: IdleMode
  setLastActiveIdleMode: (mode: IdleMode) => void
  hydrate: (saved: string | null) => void
}

export const useIdleModeStore = create<IdleModeState>((set) => ({
  lastActiveIdleMode: 'hunting',
  setLastActiveIdleMode: (mode) => set({ lastActiveIdleMode: mode }),
  hydrate: (saved) => set({ lastActiveIdleMode: saved === 'mining' ? 'mining' : 'hunting' }),
}))
