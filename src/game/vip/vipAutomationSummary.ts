// Shared shape for "what VIP automation just did" — attached to both
// OfflineProgressResult (Hunting) and OfflineMiningProgressResult (Mining)
// so the welcome-back modal can show a breakdown regardless of which idle
// mode was active, plus consumed (ignored) by the live reactive engine.
export interface VipAutomationSummary {
  oreSoldCount: number
  goldGained: number
  itemsSalvagedCount: number
  apGained: number
  itemsBankedCount: number
  compositionPointsGained: number
}

export function emptyVipAutomationSummary(): VipAutomationSummary {
  return { oreSoldCount: 0, goldGained: 0, itemsSalvagedCount: 0, apGained: 0, itemsBankedCount: 0, compositionPointsGained: 0 }
}

export function isVipAutomationSummaryEmpty(summary: VipAutomationSummary | null | undefined): boolean {
  return !summary || (summary.oreSoldCount === 0 && summary.itemsSalvagedCount === 0 && summary.itemsBankedCount === 0)
}
