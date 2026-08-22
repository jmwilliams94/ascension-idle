import { useEffect } from 'react'
import { useCharacterStore } from '../stats/useCharacterStore'
import { useVipAutomationStore } from './useVipAutomationStore'
import { useInventoryStore } from '../items/useInventoryStore'
import { useLootHoldingStore } from '../items/useLootHoldingStore'
import { runVipAutomationPass } from './runVipAutomationPass'

// Debounces a burst of Inventory/Loot Holding changes (e.g. every item
// landing from one ~4s resolve tick) into a single automation pass instead
// of one per item.
const PASS_DEBOUNCE_MS = 800

// Non-visual, mounted unconditionally in GameShell (same shape as
// CombatEngine/MiningEngine) — reacts to Inventory and Loot Holding changes
// while VIP is active, via runVipAutomationPass (see that file for the real
// logic and RPCs). This covers live play; the offline-catch-up flows
// (offlineProgress.ts/offlineMiningProgress.ts) call the same function
// synchronously right after granting rewards, so a "welcome back" summary
// doesn't have to wait on this component's debounce timer.
export default function VipAutomationEngine() {
  const vipExpiresAt = useCharacterStore((state) => state.vipExpiresAt)
  const settings = useVipAutomationStore((state) => state.settings)
  const items = useInventoryStore((state) => state.items)
  const holdingEntries = useLootHoldingStore((state) => state.entries)

  const isVipActive = Boolean(vipExpiresAt && new Date(vipExpiresAt).getTime() > Date.now())
  const settingsKey = JSON.stringify(settings)

  useEffect(() => {
    if (!isVipActive) {
      return undefined
    }

    const timeout = window.setTimeout(() => {
      void runVipAutomationPass()
    }, PASS_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
    // items/holdingEntries/settingsKey intentionally drive re-scheduling; the
    // pass itself always reads fresh state off the stores rather than
    // closed-over props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVipActive, settingsKey, items, holdingEntries])

  return null
}
