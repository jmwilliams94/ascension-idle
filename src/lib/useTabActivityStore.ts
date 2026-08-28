import { create } from 'zustand'

// Backs TabActivityIndicator.tsx — a live Realtime event (new mail, World
// Boss spawn, Gold Donation buff, a global announcement) arriving while this
// tab is hidden flips `pending`, which the indicator reflects in the tab
// title/favicon. No permission needed (unlike push notifications) since this
// only affects an already-open tab. The `document.hidden` gate lives here
// (not at each call site) so every connection component's own markPending()
// call stays a single line.
interface TabActivityState {
  pending: boolean
  markPending: () => void
  clear: () => void
}

export const useTabActivityStore = create<TabActivityState>((set) => ({
  pending: false,
  markPending: () => {
    if (document.hidden) {
      set({ pending: true })
    }
  },
  clear: () => set({ pending: false }),
}))
