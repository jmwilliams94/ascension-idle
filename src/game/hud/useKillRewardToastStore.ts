import { create } from 'zustand'
import { useTabStore } from './useTabStore'
import { useCombatModeStore } from '../combat/useCombatModeStore'

// Small centered "kill confirmed" toast (2026-08-29, requested by the user —
// "combat needs to feel precise... if an enemy dies you should get your
// experience gold etc"). Fires only off a real resolve-combat/resolve-row-
// combat response that actually confirms kills > 0 — never off the client's
// own predictive per-tick kill moment (see useCombatStore.runTick's own
// comment on why reward-on-kill no longer predicts ahead of the server) —
// so the numbers shown are always the real, server-confirmed grant, not a
// guess that might not match. One toast per resolve call, not per kill:
// resolve-combat/resolve-row-combat already batch every kill a single
// window's elapsed time covered into one `gained` total (multiple row
// slots dying in the same window included), so showing that whole-call
// total here is the natural granularity — no extra summing needed.
export interface KillRewardToastEntry {
  id: string
  gold: number
  exp: number
  kills: number
  rareKills: number
}

interface KillRewardToastState {
  toasts: KillRewardToastEntry[]
  show: (entry: Omit<KillRewardToastEntry, 'id'>) => void
  dismiss: (id: string) => void
  // Called by KillRewardToast.tsx the moment the Hunting view stops being
  // visible — a toast still on screen at that instant loses its dismiss
  // timer (mount-triggered, cancelled on unmount) but stays in `toasts`
  // otherwise, so without this it would reappear later with a full fresh
  // timer instead of just vanishing like it should have.
  clear: () => void
}

let nextToastId = 0

export const useKillRewardToastStore = create<KillRewardToastState>((set) => ({
  toasts: [],
  show: (entry) => {
    // Dropped outright while the Hunting view isn't actually on screen
    // (2026-08-29, bug fix reported by the user — a background AFK resolve
    // on another tab used to still push a toast into this array; since
    // KillRewardToast.tsx renders nothing while hidden, its per-toast
    // dismiss timer never starts either [it's a mount-triggered setTimeout],
    // so toasts silently piled up and all animated in at once the moment the
    // player switched back). Checked here via getState() rather than only in
    // the component, since a queued backlog can't build in the store at all
    // this way, not just visually.
    const { activeTab } = useTabStore.getState()
    const { mode } = useCombatModeStore.getState()
    if (activeTab !== 'combat' || mode !== 'hunting') return
    const id = `kill-reward-toast-${Date.now()}-${nextToastId++}`
    set((state) => ({ toasts: [...state.toasts, { ...entry, id }] }))
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  clear: () => set({ toasts: [] }),
}))
