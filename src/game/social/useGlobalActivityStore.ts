import { create } from 'zustand'

// Reactive display state only -- the Supabase Realtime channel itself (a
// non-serializable resource) is owned and its lifecycle managed by
// GlobalActivityConnection.tsx (mounted unconditionally in GameShell,
// same "non-visual component drives a store via useEffect" pattern
// CombatEngine.tsx already established for runTick), not by this store.
export interface GlobalAnnouncement {
  id: string
  kind: string
  characterName: string
  message: string
  createdAt: string
}

interface GlobalActivityState {
  // Distinct connected accounts (Realtime Presence, keyed by account id so
  // multiple tabs/characters on one account count once) -- see CLAUDE.md's
  // Global Activity section.
  onlineCount: number
  // Only the single most recent announcement is ever kept -- confirmed with
  // the user as "just one thing," not a scrollable history.
  latestAnnouncement: GlobalAnnouncement | null
  setOnlineCount: (count: number) => void
  setLatestAnnouncement: (announcement: GlobalAnnouncement) => void
}

export const useGlobalActivityStore = create<GlobalActivityState>((set) => ({
  onlineCount: 0,
  latestAnnouncement: null,
  setOnlineCount: (onlineCount) => set({ onlineCount }),
  setLatestAnnouncement: (latestAnnouncement) => set({ latestAnnouncement }),
}))
