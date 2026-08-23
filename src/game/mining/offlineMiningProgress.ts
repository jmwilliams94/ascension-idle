import { useMineStore } from './useMineStore'
import { useIdleModeStore } from './useIdleModeStore'
import { resolveMining } from './resolveMining'
import { OFFLINE_SUMMARY_THRESHOLD_MS } from '../combat/offlineProgress'
import { runVipAutomationPass } from '../vip/runVipAutomationPass'
import { isVipAutomationSummaryEmpty, type VipAutomationSummary } from '../vip/vipAutomationSummary'
import { useLootHoldingStore } from '../items/useLootHoldingStore'

// Mining's own away-time reconciliation, mirroring offlineProgress.ts
// exactly — the server's own mining_last_resolved_at naturally shows a large
// elapsed gap after any period away, so this is a thin wrapper around one
// resolveMining('offline') call, same shape as runOfflineProgressCheck.
//
// Gated on last_active_idle_mode === 'mining' (see useIdleModeStore) as a
// defense-in-depth check, on top of GameShell's own branch on the same
// value — Hunting and Mining can never both accrue offline progress, so this
// bails out even if somehow called when Hunting was the last active mode.

export interface OfflineMiningProgressResult {
  elapsedMs: number
  kills: number
  ore: number
  umbriteOre: number
  gems: number
  // Per-gemKey ("drake_normal", etc.) breakdown of the gems counted in `gems`
  // above — lets OfflineProgressModal render a real icon tile per gem
  // type/tier found, instead of just the aggregate count. Straight passthrough
  // of resolve-mining's own gemGrants (see its index.ts).
  gemsGranted?: Record<string, number>
  nodeDisplayName: string | null
  vipSummary?: VipAutomationSummary
}

export type OfflineMiningProgressOutcome =
  | { status: 'nothing' }
  | { status: 'error' }
  | { status: 'shown'; result: OfflineMiningProgressResult }

export async function runOfflineMiningProgressCheck(characterId: string): Promise<OfflineMiningProgressOutcome> {
  if (useIdleModeStore.getState().lastActiveIdleMode !== 'mining') {
    return { status: 'nothing' }
  }
  if (!useMineStore.getState().currentMineId) {
    return { status: 'nothing' }
  }

  const result = await resolveMining(characterId, 'offline')

  if (!result || !result.ok) {
    return { status: 'error' }
  }

  // resolveMining only *fires* a Loot Holding refetch when it grants held
  // items (a bare `void loadLootHolding(...)`, not awaited — see its own
  // comment) — awaiting a fresh load ourselves here guarantees the entries
  // just granted by the resolve above are actually in the store before the
  // automation pass reads it, not racing that fire-and-forget call.
  await useLootHoldingStore.getState().loadLootHolding(characterId)

  // Run before the "worth showing" gate below — a short away-window can
  // still have leftover Loot Holding entries from earlier sessions worth
  // auto-liquidating, and this is the one place that gap (Ore sitting
  // unsold after an AFK mining session, reported by the user) gets closed
  // deterministically rather than relying on the live reactive engine's
  // debounce timer to eventually notice.
  const vipSummary = await runVipAutomationPass()

  if (!result.gained || (result.elapsedMs ?? 0) < OFFLINE_SUMMARY_THRESHOLD_MS) {
    return { status: 'nothing' }
  }

  return {
    status: 'shown',
    result: {
      elapsedMs: result.elapsedMs ?? 0,
      kills: result.gained.kills,
      ore: result.gained.ore,
      umbriteOre: result.gained.umbriteOre,
      gems: result.gained.gems,
      gemsGranted: result.gemsGranted,
      nodeDisplayName: result.nodeDisplayName ?? null,
      vipSummary: isVipAutomationSummaryEmpty(vipSummary) ? undefined : vipSummary,
    },
  }
}
