import { create } from 'zustand'

// Explicit open/closed flag for OfflineProgressModal's "Unclaimed rewards"
// mode (2026-08-05, confirmed with the user). Previously that mode showed
// itself automatically on every GameShell mount as long as Loot Holding had
// any leftover entries — which meant a claim that partially failed (e.g. no
// Inventory room) would silently close, then resurface as what looked like a
// duplicate "welcome back" popup the next time the app loaded, with no
// deliberate action involved. Now the modal never reopens on its own outside
// of a genuinely fresh offline-progress result — UnclaimedLootBadge (a small
// fixed button, bottom-left, above the mobile nav bar) is the one deliberate
// fallback entry point for reaching leftover entries instead.
interface LootHoldingModalState {
  open: boolean
  openModal: () => void
  closeModal: () => void
}

export const useLootHoldingModalStore = create<LootHoldingModalState>((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
}))
