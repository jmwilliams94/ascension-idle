import { useEffect } from 'react'
import { useInventoryStore, occupiedSlotCount, INVENTORY_SLOT_CAP } from '../game/items/useInventoryStore'
import { useInventoryFullWarningStore } from '../game/items/useInventoryFullWarningStore'

const FLASH_DURATION_MS = 900

// Shown in GameShell's top HUD strip, alongside QuiverWarningHud — mirrors
// its exact pattern (steady warning while a condition holds, flashing red on
// a fresh trigger event). Renders nothing while Inventory has room; shows a
// steady amber warning whenever it's genuinely full (checked live, not just
// at the moment combat stopped), flashing red right when a live
// resolve-combat response actually halted the fight for it (2026-07-31,
// confirmed with the user — "a full inventory should stop combat," see
// useCombatStore.stopForInventoryFull/resolveCombat.ts). Loot Holding no
// longer catches live-play overflow at all — this is the only signal now.
export default function InventoryFullWarningHud() {
  const items = useInventoryStore((state) => state.items)
  const warningTriggeredAt = useInventoryFullWarningStore((state) => state.triggeredAt)
  const clearWarning = useInventoryFullWarningStore((state) => state.clear)

  useEffect(() => {
    if (warningTriggeredAt === null) {
      return undefined
    }

    const timeout = setTimeout(() => clearWarning(), FLASH_DURATION_MS)
    return () => clearTimeout(timeout)
  }, [warningTriggeredAt, clearWarning])

  if (occupiedSlotCount(items) < INVENTORY_SLOT_CAP) {
    return null
  }

  const flashing = warningTriggeredAt !== null
  const toneClass = flashing ? 'border-red-500 bg-red-500/30 text-red-200' : 'border-amber-600 bg-amber-500/10 text-amber-300'

  return (
    <div className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors backdrop-blur will-change-transform ${toneClass}`}>
      Inventory full
    </div>
  )
}
