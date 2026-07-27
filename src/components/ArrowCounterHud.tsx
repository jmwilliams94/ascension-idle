import { useEffect } from 'react'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useOutOfArrowsWarningStore } from '../game/items/useOutOfArrowsWarningStore'
import { ARROW_TYPES } from '../game/items/arrowTypes'

const FLASH_DURATION_MS = 900

// Hunter-only readout, bottom-left of the combat scene, showing the equipped arrow
// stack's type and remaining count — flashes red on a blocked (out-of-ammo) attack
// attempt.
export default function ArrowCounterHud() {
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const stacks = useArrowStore((state) => state.stacks)
  const equippedStackId = useArrowStore((state) => state.equippedStackId)
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

  const equippedStack = equippedStackId ? stacks.find((stack) => stack.id === equippedStackId) : undefined
  const flashing = warningTriggeredAt !== null
  const isOut = !equippedStack || equippedStack.count <= 0

  let toneClass = 'border-slate-700 bg-slate-950/80 text-slate-300'
  if (flashing) {
    toneClass = 'border-red-500 bg-red-500/30 text-red-200'
  } else if (isOut) {
    toneClass = 'border-amber-600 bg-amber-500/10 text-amber-300'
  }

  const label = isOut
    ? 'Out of arrows — visit the Shop'
    : `${ARROW_TYPES[equippedStack.arrowType].displayName}s: ${equippedStack.count}`

  return (
    <div
      className={`pointer-events-none absolute bottom-3 left-3 rounded-lg border px-3 py-1.5 text-xs font-medium backdrop-blur transition-colors ${toneClass}`}
    >
      {label}
    </div>
  )
}
