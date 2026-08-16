import { motion } from 'framer-motion'
import { compositionPointsRequired, formatCompositionTier, type CompositionSimulation } from '../game/items/forgeCosts'
import type { ItemInstance } from '../game/items/useInventoryStore'

// The load bar spanning the Upgrade+Material slots — a solid bar shows the
// item's current composition progress; whatever the staged Material would
// add on top of that renders as a separate white "tentative" segment, so it
// reads as not-yet-committed. Feed's 1s-minimum confirm delay (see
// ForgeCompositionTab's handleFeed) is what `confirming` tracks — while true,
// that white segment eases into the same amber used for committed progress,
// then the whole bar collapses once the feed actually lands and the staged
// entries clear. Shown only in the Composition tab (see ForgeCompositionTab.tsx).
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
  const required = compositionPointsRequired(item.composition_level)
  const currentPercent = required > 0 ? Math.min(100, (item.composition_points / required) * 100) : 100
  const afterPercent = preview ? (preview.required > 0 ? Math.min(100, (preview.points / preview.required) * 100) : 100) : currentPercent
  // Clamped to 0 rather than allowed negative: crossing a composition tier
  // resets the points pool against a new (usually much larger) requirement,
  // so afterPercent can legitimately land below currentPercent — the tier
  // text below already communicates that case, the bar just hides the sliver.
  const addedPercent = Math.max(0, afterPercent - currentPercent)
  const tiersGained = preview ? preview.level - item.composition_level : 0

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>
          {formatCompositionTier(item.composition_level)} composition
          {tiersGained > 0 ? ` — +${tiersGained} tier${tiersGained === 1 ? '' : 's'} pending!` : ''}
        </span>
        {addedPoints > 0 && <span>+{addedPoints} pts staged</span>}
      </div>
      <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div className="absolute inset-y-0 left-0 rounded-full bg-amber-400" style={{ width: `${currentPercent}%` }} />
        {addedPercent > 0 && (
          <motion.div
            className="absolute inset-y-0 rounded-full"
            style={{ left: `${currentPercent}%` }}
            initial={false}
            animate={{ width: `${addedPercent}%`, backgroundColor: confirming ? '#fbbf24' : '#ffffff' }}
            transition={{ width: { duration: 0.3 }, backgroundColor: { duration: confirming ? 1 : 0.2 } }}
          />
        )}
      </div>
    </div>
  )
}
