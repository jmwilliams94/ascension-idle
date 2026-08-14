import type { MaterialEntry } from './ForgeMaterialSlot'
import { Button } from './ui/Button'
import { compositionPointValue, compositionPointsRequired, formatCompositionTier, isCompositionMaxed, simulateCompositionFeed } from '../game/items/forgeCosts'
import type { ItemInstance } from '../game/items/useInventoryStore'

interface ForgeCompositionPanelProps {
  item: ItemInstance
  entries: MaterialEntry[]
  busy: boolean
  onFeed: () => void
  feedError: string | null
}

export function ProgressBar({ level, points, required }: { level: number; points: number; required: number }) {
  const percent = required > 0 ? Math.min(100, (points / required) * 100) : 100

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span className="font-medium text-slate-300">{formatCompositionTier(level)}</span>
        <span>
          {points} / {required}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-sky-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

// Composition preview (shown in Forge's Preview column once the Material slot
// holds a stone/gear entry — see ForgePanel's materialMode inference) — no
// RNG, no success/fail state: the player drags up to two stones and/or gear
// items into the Material slot (see ForgeMaterialSlot, rendered separately
// now — this component only shows the resulting progress + Feed button), sees
// exactly what feeding them would do (including crossing one or more tiers at
// once), and commits with "Feed", which always applies the full point value.
// The live composition "loading bar" spanning the Upgrade+Material columns
// (ForgePanel's CompositionLoadBar) duplicates the "after feed" bar below for
// visibility at a glance — this panel is still the source of the Feed action
// itself.
export default function ForgeCompositionPanel({ item, entries, busy, onFeed, feedError }: ForgeCompositionPanelProps) {
  const maxed = isCompositionMaxed(item.composition_level)
  const required = compositionPointsRequired(item.composition_level)

  const addedPoints = entries.reduce((sum, entry) => {
    if (entry.kind === 'stone') {
      return sum + compositionPointValue(entry.tier)
    }
    if (entry.kind === 'item') {
      return sum + compositionPointValue(entry.item.composition_level)
    }
    return sum
  }, 0)

  const preview = !maxed && addedPoints > 0 ? simulateCompositionFeed(item.composition_level, item.composition_points, addedPoints) : null
  const tiersGained = preview ? preview.level - item.composition_level : 0

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-600">Current</p>
        <ProgressBar level={item.composition_level} points={item.composition_points} required={required} />
      </div>

      {preview && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-600">
            After feed{tiersGained > 0 ? ` — +${tiersGained} tier${tiersGained === 1 ? '' : 's'}!` : ''}
          </p>
          <ProgressBar level={preview.level} points={preview.points} required={preview.required} />
        </div>
      )}

      {maxed && <p className="text-center text-[10px] text-slate-500">Already at maximum composition (+{item.composition_level}).</p>}
      {feedError && <p className="text-center text-[10px] text-red-400">{feedError}</p>}

      <Button variant="primary" disabled={busy || maxed || addedPoints <= 0} onClick={onFeed} className="w-full">
        {busy ? 'Feeding…' : 'Feed'}
      </Button>
    </div>
  )
}
