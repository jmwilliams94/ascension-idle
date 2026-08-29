import { useEffect } from 'react'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useNoQuiverWarningStore } from '../game/items/useNoQuiverWarningStore'

const FLASH_DURATION_MS = 900

// Hunter-only readout, shown in GameShell's top HUD strip — replaces the old
// ArrowCounterHud now that there's no ammo count to show (2026-07-31, see
// CLAUDE.md's Classes section): a Hunter can attack freely as long as the
// Quiver is equipped, so there's nothing to display in the common case
// ("you're chilling"). Only renders a warning when a Hunter has no Quiver
// equipped, flashing on a blocked attack attempt.
export default function QuiverWarningHud() {
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const hasQuiver = useEquipmentStore((state) => state.equippedIds.quiver !== null)
  const warningTriggeredAt = useNoQuiverWarningStore((state) => state.triggeredAt)
  const clearWarning = useNoQuiverWarningStore((state) => state.clear)

  useEffect(() => {
    if (warningTriggeredAt === null) {
      return undefined
    }

    const timeout = setTimeout(() => clearWarning(), FLASH_DURATION_MS)
    return () => clearTimeout(timeout)
  }, [warningTriggeredAt, clearWarning])

  if (selectedClassId !== 'hunter' || hasQuiver) {
    return null
  }

  const flashing = warningTriggeredAt !== null
  const toneClass = flashing ? 'border-red-500 bg-red-500/30 text-red-200' : 'border-amber-600 bg-amber-500/10 text-amber-300'

  return (
    <div className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors backdrop-blur will-change-transform ${toneClass}`}>
      No quiver equipped
    </div>
  )
}
