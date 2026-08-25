import { create } from 'zustand'

// Fed by GlobalActivityConnection.tsx, which owns the only Realtime channel
// reference (a non-serializable resource -- same reasoning as
// useGlobalActivityStore.ts keeping the channel itself out of this store).
// otherSessionIds is only ever cleared by SessionConflictModal resolving one
// of its two choices (evict the other session, or cancel this one) -- there
// is no implicit dismiss, so the account never ends up with two sessions
// both left running unresolved.
interface SessionConflictState {
  otherSessionIds: string[] | null
  evictedByOther: boolean
  requestEvictOthers: ((targetSessionIds: string[]) => void) | null
  setOtherSessions: (sessionIds: string[]) => void
  clearOtherSessions: () => void
  setEvictedByOther: () => void
  dismissEvicted: () => void
  setRequestEvictOthers: (fn: ((targetSessionIds: string[]) => void) | null) => void
}

export const useSessionConflictStore = create<SessionConflictState>((set) => ({
  otherSessionIds: null,
  evictedByOther: false,
  requestEvictOthers: null,
  setOtherSessions: (otherSessionIds) => set({ otherSessionIds }),
  clearOtherSessions: () => set({ otherSessionIds: null }),
  setEvictedByOther: () => set({ evictedByOther: true }),
  dismissEvicted: () => set({ evictedByOther: false }),
  setRequestEvictOthers: (requestEvictOthers) => set({ requestEvictOthers }),
}))
