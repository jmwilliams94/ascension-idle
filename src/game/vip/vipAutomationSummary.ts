// Shared shape for "what VIP automation just did" — attached to both
// OfflineProgressResult (Hunting) and OfflineMiningProgressResult (Mining)
// so the welcome-back modal can show a breakdown regardless of which idle
// mode was active, plus consumed (ignored) by the live reactive engine.
export interface VipAutomationSummary {
  oreSoldCount: number
  oreGoldGained: number
  // Normal-quality gear sold via autoSellGear — its own count/gold pair
  // (distinct from Ore's) so the welcome-back modal can show each auto-sell
  // rule's own row instead of a combined, mislabeled total.
  itemsSoldCount: number
  gearGoldGained: number
  itemsSalvagedCount: number
  apGained: number
  itemsBankedCount: number
  compositionPointsGained: number
}

export function emptyVipAutomationSummary(): VipAutomationSummary {
  return {
    oreSoldCount: 0,
    oreGoldGained: 0,
    itemsSoldCount: 0,
    gearGoldGained: 0,
    itemsSalvagedCount: 0,
    apGained: 0,
    itemsBankedCount: 0,
    compositionPointsGained: 0,
  }
}

export function isVipAutomationSummaryEmpty(summary: VipAutomationSummary | null | undefined): boolean {
  return (
    !summary ||
    (summary.oreSoldCount === 0 && summary.itemsSoldCount === 0 && summary.itemsSalvagedCount === 0 && summary.itemsBankedCount === 0)
  )
}
