import ForgeFuelZone, { type FuelEntry } from './ForgeFuelZone'
import { compositionPointValue, compositionPointsRequired, formatCompositionTier, simulateCompositionFeed } from '../game/items/forgeCosts'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

interface ForgeCompositionPanelProps {
  item: ItemInstance
  fuelEntries: FuelEntry[]
  templates: ItemTemplate[]
  onDropFuelId: (id: string) => void
  onRemoveFuel: (id: string) => void
  busy: boolean
  onFeed: () => void
  feedError: string | null
}

function ProgressBar({ level, points, required }: { level: number; points: number; required: number }) {
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

// Composition tab content — no RNG, no success/fail state (see ForgePanel): the
// player drags stones and/or gear into the Fuel zone (same drag-and-drop as the
// main Upgrade Slot — stones are items here, not a typed-in currency amount), sees
// exactly what feeding them would do (including crossing one or more tiers at
// once), and commits with "Feed", which always applies the full point value.
export default function ForgeCompositionPanel({
  item,
  fuelEntries,
  templates,
  onDropFuelId,
  onRemoveFuel,
  busy,
  onFeed,
  feedError,
}: ForgeCompositionPanelProps) {
  const required = compositionPointsRequired(item.composition_level)

  const addedPoints = fuelEntries.reduce((sum, entry) => {
    if (entry.kind === 'stone') {
      return sum + compositionPointValue(entry.tier)
    }
    return sum + compositionPointValue(entry.item.composition_level)
  }, 0)

  const preview = addedPoints > 0 ? simulateCompositionFeed(item.composition_level, item.composition_points, addedPoints) : null
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

      <ForgeFuelZone fuelEntries={fuelEntries} templates={templates} onDropItemId={onDropFuelId} onRemove={onRemoveFuel} />

      {feedError && <p className="text-center text-[10px] text-red-400">{feedError}</p>}

      <button
        type="button"
        disabled={busy || addedPoints <= 0}
        onClick={onFeed}
        className="w-full rounded-lg border border-emerald-600 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Feeding…' : 'Feed'}
      </button>
    </div>
  )
}
