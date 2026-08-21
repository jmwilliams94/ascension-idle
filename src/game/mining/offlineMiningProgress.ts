import { useMineStore } from './useMineStore'
import { useIdleModeStore } from './useIdleModeStore'
import { resolveMining } from './resolveMining'
import { OFFLINE_SUMMARY_THRESHOLD_MS } from '../combat/offlineProgress'

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
  gems: number
  nodeDisplayName: string | null
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

  if (!result.gained || (result.elapsedMs ?? 0) < OFFLINE_SUMMARY_THRESHOLD_MS) {
    return { status: 'nothing' }
  }

  return {
    status: 'shown',
    result: {
      elapsedMs: result.elapsedMs ?? 0,
      kills: result.gained.kills,
      ore: result.gained.ore,
      gems: result.gained.gems,
      nodeDisplayName: result.nodeDisplayName ?? null,
    },
  }
}
