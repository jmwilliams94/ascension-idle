import { useEffect, useRef, useState } from 'react'
import { useAnimationControls, motion } from 'framer-motion'
import {
  COMPOSITION_FEED_FIRST_STEP_SECONDS,
  COMPOSITION_FEED_STEP_RESET_MS,
  COMPOSITION_FEED_STEP_SECONDS,
  compositionPointsRequired,
  formatCompositionTier,
  simulateCompositionFeedSteps,
  type CompositionSimulation,
} from '../game/items/forgeCosts'
import type { ItemInstance } from '../game/items/useInventoryStore'

const AMBER = '#fbbf24'
const WHITE = '#ffffff'

// The load bar spanning the Upgrade+Material slots. Two layers: a solid
// "base" bar (always the real committed progress within whichever tier is
// currently on screen) and one animated "overlay" bar on top of it (the
// framer-motion `controls` below) that represents whatever the staged
// Material would add.
//
// Pre-confirm, the overlay renders white — full width (100%) if the feed
// would complete the current tier (the exact resulting position on the
// *next* tier isn't knowable on this single 0-100 bar until the confirm
// animation actually plays it out), otherwise the precise in-tier amount.
//
// On Feed, that white overlay eases into amber over one second, in place —
// same width, just a color change, since it already sat exactly where the
// first tier's fill ends. If that's the whole feed (stays within the current
// tier), the animation stops there. If it completes one or more further
// tiers, the base bar collapses to 0 (a new tier always starts at 0 points)
// and the overlay resets to 0% width, pauses briefly, then fills to 100% —
// repeating one tier at a time until it lands on the final tier's leftover
// amount. ForgeCompositionTab's minimum feed delay
// (estimateCompositionFeedAnimationMs) keeps the real server response from
// cutting this animation off early.
export default function CompositionLoadBar({
  item,
  addedPoints,
  preview,
  confirming,
}: {
  item: ItemInstance
  addedPoints: number
  preview: CompositionSimulation | null
  confirming: boolean
}) {
  const controls = useAnimationControls()
  const [animatedLevel, setAnimatedLevel] = useState(item.composition_level)
  const [onFirstStep, setOnFirstStep] = useState(true)
  const wasConfirming = useRef(false)

  const required = compositionPointsRequired(item.composition_level)
  const currentPercent = required > 0 ? Math.min(100, (item.composition_points / required) * 100) : 100
  const afterPercent = preview ? (preview.required > 0 ? Math.min(100, (preview.points / preview.required) * 100) : 100) : currentPercent
  const tiersGained = preview ? preview.level - item.composition_level : 0

  useEffect(() => {
    if (!confirming) {
      wasConfirming.current = false

      // Reactive tentative preview: full-width when this feed would complete
      // the current tier (the multi-tier case, whose real end position isn't
      // knowable on this bar until confirmed), otherwise the precise in-tier
      // amount. Clamped to 0 so an empty/staled staging never goes negative.
      const tentativePercent = addedPoints <= 0 ? 0 : tiersGained > 0 ? Math.max(0, 100 - currentPercent) : Math.max(0, afterPercent - currentPercent)
      void controls.start({ left: `${currentPercent}%`, width: `${tentativePercent}%`, backgroundColor: WHITE }, { duration: 0.3 })
      return
    }

    if (wasConfirming.current) {
      return
    }
    wasConfirming.current = true

    const steps = simulateCompositionFeedSteps(item.composition_level, item.composition_points, addedPoints)
    let cancelled = false

    void (async () => {
      for (let i = 0; i < steps.length; i += 1) {
        if (cancelled) return
        const step = steps[i]
        const fromPercent = step.required > 0 ? Math.min(100, (step.fromPoints / step.required) * 100) : 100
        const toPercent = step.required > 0 ? Math.min(100, (step.toPoints / step.required) * 100) : 100

        setAnimatedLevel(step.level)

        if (i === 0) {
          // First tier: the overlay just changes color in place (white ->
          // amber) — it's already sitting at exactly this width from the
          // pre-confirm tentative preview above.
          setOnFirstStep(true)
          controls.set({ left: `${fromPercent}%`, width: `${toPercent - fromPercent}%`, backgroundColor: WHITE })
          await controls.start({ backgroundColor: AMBER }, { duration: COMPOSITION_FEED_FIRST_STEP_SECONDS })
        } else {
          // A new tier always starts at 0 points — collapse the base bar
          // (render below) and have the overlay play out this tier's fill
          // on its own, from a brief pause at 0% up to its result.
          setOnFirstStep(false)
          controls.set({ left: '0%', width: '0%', backgroundColor: AMBER })
          await new Promise((resolve) => setTimeout(resolve, COMPOSITION_FEED_STEP_RESET_MS))
          if (cancelled) return
          await controls.start({ width: `${toPercent}%` }, { duration: COMPOSITION_FEED_STEP_SECONDS })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [confirming, addedPoints, tiersGained, currentPercent, afterPercent, item.composition_level, item.composition_points, controls])

  const displayLevel = confirming ? animatedLevel : item.composition_level
  const pendingTiers = confirming ? Math.max(0, (preview?.level ?? item.composition_level) - animatedLevel) : tiersGained
  const baseWidthPercent = confirming && !onFirstStep ? 0 : currentPercent

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>
          {formatCompositionTier(displayLevel)} composition
          {pendingTiers > 0 ? ` — +${pendingTiers} tier${pendingTiers === 1 ? '' : 's'} pending!` : ''}
        </span>
        {addedPoints > 0 && <span>+{addedPoints} pts staged</span>}
      </div>
      <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div className="absolute inset-y-0 left-0 rounded-full bg-amber-400 transition-[width] duration-300" style={{ width: `${baseWidthPercent}%` }} />
        <motion.div className="absolute inset-y-0 rounded-full" style={{ left: 0, width: 0 }} animate={controls} initial={false} />
      </div>
    </div>
  )
}
