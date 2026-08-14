import { motion } from 'framer-motion'
import { compositionPointsRequired, formatCompositionTier, type CompositionSimulation } from '../game/items/forgeCosts'
import type { ItemInstance } from '../game/items/useInventoryStore'

// The load bar spanning the Upgrade+Material slots — a dim bar shows the
// item's current composition progress, a brighter bar stretches out to
// whatever the staged Material would produce if fed. Shown only in the
// Composition tab (see ForgeCompositionTab.tsx).
export default function CompositionLoadBar({
  item,
  addedPoints,
  preview,
}: {
  item: ItemInstance
  addedPoints: number
  preview: CompositionSimulation | null
}) {
  const required = compositionPointsRequired(item.composition_level)
  const currentPercent = required > 0 ? Math.min(100, (item.composition_points / required) * 100) : 100
  const afterPercent = preview ? (preview.required > 0 ? Math.min(100, (preview.points / preview.required) * 100) : 100) : currentPercent
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
        <div className="absolute inset-y-0 left-0 rounded-full bg-amber-500/40" style={{ width: `${currentPercent}%` }} />
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-amber-400"
          initial={false}
          animate={{ width: `${afterPercent}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
    </div>
  )
}
