import { useEffect, useRef, useState } from 'react'
import { useAnimationControls, motion } from 'framer-motion'
import { EmberBurstPoint } from './EmberBurstPoint'
import {
  COMPOSITION_FEED_FIRST_STEP_SECONDS,
  COMPOSITION_FEED_STEP_RESET_MS,
  COMPOSITION_FEED_STEP_SECONDS,
  COMPOSITION_MAX_LEVEL,
  compositionPointsRequired,
  formatCompositionTier,
  isCompositionMaxed,
  simulateCompositionFeedSteps,
  type CompositionSimulation,
} from '../game/items/forgeCosts'
import { seedFromId } from '../game/items/tierEffectsData'
import type { ItemInstance } from '../game/items/useInventoryStore'

const AMBER = '#fbbf24'
const WHITE = '#ffffff'
const BURST_DISPLAY_MS = 2000

interface Burst {
  id: number
  seed: number
  x: number
}

// The single load bar spanning the Upgrade+Material slots — one bar, one job
// at a time, fixed size regardless of what's staged (a `w-8` reserved slot on
// each side for the flanking "+N" labels, so neither their text nor the bar
// itself ever changes width as material is added/removed):
//
// - Nothing staged: plain amber fill at the item's real committed progress.
// - Material staged, not yet confirmed: fill turns white and previews where
//   confirming would land it — full width (100%) if it would complete the
//   current tier (the exact position on the *next* tier isn't knowable on
//   this bar until the confirm animation below plays it out), otherwise the
//   precise in-tier amount. The "next +N" tier and its point cost show
//   centered below the bar instead, since there's nothing to preview yet.
// - On Feed: the bar snaps back to the real committed position, turns
//   yellow, and loads left-to-right up to the target over one second. If
//   that fill reaches the bar's right edge (i.e. it completed a tier), a
//   white ember burst fires there and, if more tiers remain, the bar resets
//   to 0% and repeats for the next tier — one at a time — until it lands on
//   the final tier's leftover amount. ForgeCompositionTab's minimum feed
//   delay (estimateCompositionFeedAnimationMs) keeps the real server
//   response from cutting this animation off early.
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
  const [bursts, setBursts] = useState<Burst[]>([])
  const wasConfirming = useRef(false)
  const nextBurstId = useRef(0)

  const required = compositionPointsRequired(item.composition_level)
  const currentPercent = required > 0 ? Math.min(100, (item.composition_points / required) * 100) : 100
  const afterPercent = preview ? (preview.required > 0 ? Math.min(100, (preview.points / preview.required) * 100) : 100) : currentPercent
  const tiersGained = preview ? preview.level - item.composition_level : 0
  const maxed = isCompositionMaxed(item.composition_level)
  const nextLevel = Math.min(item.composition_level + 1, COMPOSITION_MAX_LEVEL)
  const nextCost = compositionPointsRequired(item.composition_level)

  const spawnBurst = (x: number) => {
    const id = nextBurstId.current++
    setBursts((current) => [...current, { id, seed: seedFromId(`composition-burst-${id}`), x }])
    setTimeout(() => setBursts((current) => current.filter((burst) => burst.id !== id)), BURST_DISPLAY_MS)
  }

  useEffect(() => {
    if (!confirming) {
      wasConfirming.current = false

      const targetPercent = addedPoints <= 0 ? currentPercent : tiersGained > 0 ? 100 : Math.max(currentPercent, afterPercent)
      void controls.start({ width: `${targetPercent}%`, backgroundColor: addedPoints <= 0 ? AMBER : WHITE }, { duration: 0.3 })
      return
    }

    if (wasConfirming.current) {
      return
    }
    wasConfirming.current = true

    // Read item/addedPoints from this render's closure rather than the
    // dependency array below: compositionFeed patches the item's real
    // composition_level/_points into the store as soon as the RPC resolves —
    // almost always well before this cascade finishes playing out — and
    // reacting to that mid-flight update (via a dependency-array re-run)
    // would tear the cascade down before it completes. Since the effect only
    // depends on `confirming`, this closure is guaranteed to hold the values
    // from the render where confirming flipped true, i.e. before the RPC
    // fired, which is what the cascade needs to be computed against.
    const steps = simulateCompositionFeedSteps(item.composition_level, item.composition_points, addedPoints)
    let cancelled = false

    void (async () => {
      for (let i = 0; i < steps.length; i += 1) {
        if (cancelled) return
        const step = steps[i]
        const fromPercent = step.required > 0 ? Math.min(100, (step.fromPoints / step.required) * 100) : 100
        const toPercent = step.required > 0 ? Math.min(100, (step.toPoints / step.required) * 100) : 100

        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, COMPOSITION_FEED_STEP_RESET_MS))
          if (cancelled) return
        }

        setAnimatedLevel(step.level)
        controls.set({ width: `${fromPercent}%`, backgroundColor: AMBER })
        await controls.start({ width: `${toPercent}%` }, { duration: i === 0 ? COMPOSITION_FEED_FIRST_STEP_SECONDS : COMPOSITION_FEED_STEP_SECONDS })
        if (cancelled) return

        if (toPercent >= 100) {
          spawnBurst(toPercent)
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- confirming/controls only, deliberately: see the closure comment above for why item/addedPoints must NOT be deps.
  }, [confirming, controls])

  const displayLevel = confirming ? animatedLevel : item.composition_level
  const targetLevel = preview ? preview.level : null

  return (
    <div className="mx-auto w-full max-w-xs">
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 text-right text-xs font-medium text-slate-300">{formatCompositionTier(displayLevel)}</span>

        <div className="relative h-2.5 flex-1">
          <div className="absolute inset-0 overflow-hidden rounded-full bg-slate-800">
            <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ width: 0 }} animate={controls} initial={false} />
          </div>
          {bursts.map((burst) => (
            <div key={burst.id} className="pointer-events-none absolute inset-0 overflow-visible">
              <EmberBurstPoint x={burst.x} y={50} color={AMBER} seed={burst.seed} radius={70} emberCount={20} />
            </div>
          ))}
        </div>

        <span className="w-8 shrink-0 text-left text-xs font-medium text-amber-300">{targetLevel !== null ? formatCompositionTier(targetLevel) : ''}</span>
      </div>

      <div className="mt-1 h-4 text-center text-[10px] text-slate-500">
        {!preview && !maxed ? `Next ${formatCompositionTier(nextLevel)} — ${nextCost} pts` : ''}
      </div>
    </div>
  )
}
