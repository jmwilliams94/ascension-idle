import ForgeFuelZone from './ForgeFuelZone'
import {
  COMPOSITION_STONE_TIERS,
  compositionPointValue,
  compositionPointsRequired,
  formatCompositionTier,
  simulateCompositionFeed,
} from '../game/items/forgeCosts'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'
import type { CompositionStones } from '../game/items/useCompositionStore'

interface ForgeCompositionPanelProps {
  item: ItemInstance
  fuelItems: ItemInstance[]
  templates: ItemTemplate[]
  stones: CompositionStones
  stoneAmounts: Record<string, number>
  onStoneAmountChange: (tier: string, amount: number) => void
  onDropFuelItemId: (itemId: string) => void
  onRemoveFuel: (itemId: string) => void
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
// player picks stones + fuel, sees exactly what feeding them would do (including
// crossing one or more tiers at once), and commits with "Feed", which always
// applies its full point value.
export default function ForgeCompositionPanel({
  item,
  fuelItems,
  templates,
  stones,
  stoneAmounts,
  onStoneAmountChange,
  onDropFuelItemId,
  onRemoveFuel,
  busy,
  onFeed,
  feedError,
}: ForgeCompositionPanelProps) {
  const required = compositionPointsRequired(item.composition_level)

  const addedPoints =
    COMPOSITION_STONE_TIERS.reduce(
      (sum, tier) => sum + (stoneAmounts[String(tier)] ?? 0) * compositionPointValue(tier),
      0,
    ) + fuelItems.reduce((sum, fuelItem) => sum + compositionPointValue(fuelItem.composition_level), 0)

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

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-slate-600">Stones</p>

        {COMPOSITION_STONE_TIERS.map((tier) => {
          const tierKey = String(tier)
          const owned = stones[tierKey] ?? 0
          const amount = stoneAmounts[tierKey] ?? 0

          return (
            <div key={tier} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-400">
                +{tier} Stone <span className="text-slate-600">(own {owned})</span>
              </span>
              <input
                type="number"
                min={0}
                max={owned}
                value={amount}
                onChange={(event) => {
                  const next = Math.max(0, Math.min(owned, Math.floor(Number(event.target.value)) || 0))
                  onStoneAmountChange(tierKey, next)
                }}
                className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-right text-slate-200"
              />
            </div>
          )
        })}
      </div>

      <ForgeFuelZone fuelItems={fuelItems} templates={templates} onDropItemId={onDropFuelItemId} onRemove={onRemoveFuel} />

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
