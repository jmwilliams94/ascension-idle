// VIP auto-salvage/auto-bank (see runVipAutomationPass.ts) must only ever
// touch items that came from an enemy/mining drop (live combat, offline
// catch-up, or claiming one out of Loot Holding) — never items the player
// brought into Inventory themselves (Bank withdraw, Mail claim, Marketplace,
// Lucky Lad, achievement rewards, Promotion rewards). Reported bug: a Bank
// Storage withdraw landed in Inventory and got auto-salvaged within the same
// second, because the automation pass swept every non-bank/non-equipped
// Inventory item with no regard for where it came from.
//
// A plain module-level Set, not Zustand state — nothing renders off this,
// it's only consulted synchronously inside runVipAutomationPass. Cleared by
// useInventoryStore.removeItems so it never grows unbounded across a session.
const dropSourcedItemIds = new Set<string>()

export function markDropSourced(itemId: string): void {
  dropSourcedItemIds.add(itemId)
}

export function isDropSourced(itemId: string): boolean {
  return dropSourcedItemIds.has(itemId)
}

export function clearDropSourced(itemId: string): void {
  dropSourcedItemIds.delete(itemId)
}
