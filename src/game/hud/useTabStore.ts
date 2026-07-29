import { create } from 'zustand'

// Which page is currently showing — replaces useOverlayStore now that pages are
// full tabs rather than overlays on top of a canvas. Unlike the overlay version
// there's no null/"closed" state: a tab is always showing something.
export type TabId = 'combat' | 'equipment' | 'forge' | 'marketplace' | 'shop'

interface TabState {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
}

export const useTabStore = create<TabState>((set) => ({
  activeTab: 'combat',
  setActiveTab: (tab) => set({ activeTab: tab }),
}))
