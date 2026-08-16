import { CLASS_DEFINITIONS, type ClassId } from './classes'
import type { PromotionTier } from '../items/usePromotionStore'

// Pure derivations over already-subscribed store state (tiers from
// usePromotionStore, classId/promotionLevel from useCharacterStore) — same
// shape as getAttributesForLevel in classes.ts, no store coupling of its own.

// Every class starts as "Novice <ClassName>" (confirmed with the user) before
// its first promotion — not a promotion_tiers row, just a fixed convention
// derived from CLASS_DEFINITIONS' own displayName.
function startingTitle(classId: string): string {
  const displayName = classId in CLASS_DEFINITIONS ? CLASS_DEFINITIONS[classId as ClassId].displayName : classId
  return `Novice ${displayName}`
}

export function getCurrentPromotionTitle(tiers: PromotionTier[], classId: string, promotionLevel: number): string {
  if (promotionLevel === 0) {
    return startingTitle(classId)
  }
  return tiers.find((tier) => tier.class === classId && tier.level === promotionLevel)?.title ?? startingTitle(classId)
}

export function getNextEligiblePromotionTier(tiers: PromotionTier[], classId: string, promotionLevel: number): PromotionTier | null {
  const candidates = tiers
    .filter((tier) => tier.class === classId && tier.level > promotionLevel)
    .sort((a, b) => a.level - b.level)

  return candidates[0] ?? null
}
