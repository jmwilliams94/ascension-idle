import type { PotionStack } from './usePotionStore'
import { HP_POTION_ORDER, MP_POTION_ORDER, type PotionTypeId } from './potionTypes'

// Shared "best owned tier + total owned across every tier" selectors for the
// HP/Mana potion summary row (InventoryPanel.tsx, CombatPage.tsx,
// PotionAutoUseEngine.tsx) — a player can own several tiers of the same kind
// at once (e.g. Sprigroot Tonic AND Verdant Balm), and every UI that shows
// "your HP potion" should agree on which one that is (the highest tier still
// in stock) and how many you really have (summed across every tier, not just
// that one stack).

// Highest-tier stack (by potionTypes.ts's own ascending-level ordering) that
// still has any left, or null if none of this kind are owned at all.
export function findBestPotionStack(stacks: PotionStack[], order: readonly PotionTypeId[]): PotionStack | null {
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const found = stacks.find((stack) => stack.potionType === order[i] && stack.count > 0)
    if (found) {
      return found
    }
  }
  return null
}

// Sum of every tier's count for this kind — "how many potions do I have,"
// not just the best tier's own stack count.
export function totalPotionCount(stacks: PotionStack[], order: readonly PotionTypeId[]): number {
  return stacks.reduce((sum, stack) => (order.includes(stack.potionType) ? sum + stack.count : sum), 0)
}

export function findBestHpPotionStack(stacks: PotionStack[]): PotionStack | null {
  return findBestPotionStack(stacks, HP_POTION_ORDER)
}

export function findBestMpPotionStack(stacks: PotionStack[]): PotionStack | null {
  return findBestPotionStack(stacks, MP_POTION_ORDER)
}

export function totalHpPotionCount(stacks: PotionStack[]): number {
  return totalPotionCount(stacks, HP_POTION_ORDER)
}

export function totalMpPotionCount(stacks: PotionStack[]): number {
  return totalPotionCount(stacks, MP_POTION_ORDER)
}
