import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { seedFromId } from '../game/items/tierEffectsData'
import { EmberBurstPoint } from './EmberBurstPoint'

// The "Level up!" notice — pulled out of ExpBar.tsx (2026-08-20, reported by
// the user: the old version was `position: absolute` inside ExpBar's own
// flex-item container, which is only as wide as that item (min-w-[240px]),
// so on a wrapped/cramped top HUD row it could sit oddly relative to its own
// bar). Now a portaled, fixed, very-high-z-index overlay — genuinely on top
// of everything, immune to any ancestor's stacking/overflow — plus a gold
// confetti-ember burst around it (same buildConfettiEmbers/EmberBurstPoint
// mechanics as FireworkOverlay, just gold-only and scoped to a few points
// around the banner instead of scattered across the whole screen).
const DISPLAY_MS = 2400
const GOLD_COLOR = '#FFD700'
const BURST_POINTS = [
  { x: 50, y: 50 },
  { x: 12, y: 25 },
  { x: 88, y: 25 },
  { x: 12, y: 75 },
  { x: 88, y: 75 },
]
const BURST_STAGGER_S = 0.06

interface Burst {
  x: number
  y: number
  seed: number
  delay: number
}

export default function LevelUpBanner() {
  const lastLevelUp = useProgressionStore((state) => state.lastLevelUp)
  const clearLevelUpNotice = useProgressionStore((state) => state.clearLevelUpNotice)

  useEffect(() => {
    if (lastLevelUp === null) {
      return undefined
    }
    const timeout = setTimeout(clearLevelUpNotice, DISPLAY_MS)
    return () => clearTimeout(timeout)
  }, [lastLevelUp, clearLevelUpNotice])

  const bursts = useMemo<Burst[]>(() => {
    if (lastLevelUp === null) {
      return []
    }
    return BURST_POINTS.map((point, i) => ({
      ...point,
      seed: seedFromId(`levelup-${lastLevelUp}-${i}`),
      delay: i * BURST_STAGGER_S,
    }))
  }, [lastLevelUp])

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[80] flex justify-center px-4">
      <AnimatePresence>
        {lastLevelUp !== null && (
          <motion.div
            key={lastLevelUp}
            initial={{ opacity: 0, y: -12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            className="relative rounded-lg border border-amber-400/60 bg-amber-400/10 px-4 py-2 text-center text-sm font-semibold text-amber-300 lg:backdrop-blur"
          >
            {bursts.map((burst, i) => (
              <EmberBurstPoint key={i} x={burst.x} y={burst.y} color={GOLD_COLOR} delay={burst.delay} seed={burst.seed} radius={70} emberCount={16} />
            ))}
            <span className="relative z-10">Level up! You're now level {lastLevelUp}.</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
