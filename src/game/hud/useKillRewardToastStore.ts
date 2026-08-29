import { create } from 'zustand'

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
}

let nextToastId = 0

export const useKillRewardToastStore = create<KillRewardToastState>((set) => ({
  toasts: [],
  show: (entry) => {
    const id = `kill-reward-toast-${Date.now()}-${nextToastId++}`
    set((state) => ({ toasts: [...state.toasts, { ...entry, id }] }))
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
