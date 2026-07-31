import { useEffect } from 'react'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useOutOfArrowsWarningStore } from '../game/items/useOutOfArrowsWarningStore'
import { ARROW_TYPES } from '../game/items/arrowTypes'

const FLASH_DURATION_MS = 900

// Hunter-only readout, shown in GameShell's top HUD strip, showing the
// Quiver's totalled ammo count across all 3 loaded stacks — flashes red on a
// blocked (out-of-ammo) attack attempt.
export default function ArrowCounterHud() {
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const stacks = useArrowStore((state) => state.stacks)
  const warningTriggeredAt = useOutOfArrowsWarningStore((state) => state.triggeredAt)
  const clearWarning = useOutOfArrowsWarningStore((state) => state.clear)

  useEffect(() => {
    if (warningTriggeredAt === null) {
      return undefined
    }

    const timeout = setTimeout(() => clearWarning(), FLASH_DURATION_MS)
    return () => clearTimeout(timeout)
  }, [warningTriggeredAt, clearWarning])

  if (selectedClassId !== 'hunter') {
    return null
  }

  const loadedStacks = stacks.filter((stack) => stack.quiverSlot !== null)
  const totalCount = loadedStacks.reduce((sum, stack) => sum + stack.count, 0)
  const flashing = warningTriggeredAt !== null
  const isOut = totalCount <= 0

  let toneClass = 'border-slate-700 bg-slate-950/80 text-slate-300'
  if (flashing) {
    toneClass = 'border-red-500 bg-red-500/30 text-red-200'
  } else if (isOut) {
    toneClass = 'border-amber-600 bg-amber-500/10 text-amber-300'
  }

  // A mix of arrow types loaded shows a generic "Ammo" label; a single type
  // loaded (the common case) names it, matching the earlier single-stack HUD.
  const distinctTypes = new Set(loadedStacks.filter((stack) => stack.count > 0).map((stack) => stack.arrowType))
  const typeLabel = distinctTypes.size === 1 ? `${ARROW_TYPES[[...distinctTypes][0]].displayName}s` : 'Ammo'

  const label = isOut ? 'Out of arrows — visit the Shop' : `${typeLabel}: ${totalCount}`

  return (
    <div className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium backdrop-blur transition-colors ${toneClass}`}>
      {label}
    </div>
  )
}
