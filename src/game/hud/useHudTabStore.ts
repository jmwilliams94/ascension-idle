import { create } from 'zustand'

// Shared so both the sidebar tab strip (HudTabs) and the bottom nav (BottomNav) drive
// the same active view instead of maintaining separate state — the bottom nav is
// just a second, thumb-reachable way to switch between the same panels.
export type HudTabId = 'stats' | 'zone' | 'inventory' | 'equipment' | 'forge' | 'marketplace'

interface HudTabState {
  activeTab: HudTabId
  setActiveTab: (tab: HudTabId) => void
}

export const useHudTabStore = create<HudTabState>((set) => ({
  activeTab: 'stats',
  setActiveTab: (tab) => set({ activeTab: tab }),
}))
