import { useState } from 'react'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { formatItemDisplayName, formatQualityAndLevel, getQualityColor } from '../game/items/equipmentBonus'
import { previewLevelUpgradeCost, previewQualityUpgradeCost } from '../game/items/forgeCosts'
import { useForgeStore } from '../game/items/useForgeStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

// Mirrors the migration's v_level_cap placeholder — only used here to show "Max" on
// the button instead of a cost; the real cap enforcement lives server-side.
const ITEM_LEVEL_CAP = 130

function describeResult(
  result: { ok: boolean; error?: string; upgraded?: boolean },
  successNoun: string,
): string {
  if (!result.ok) {
    switch (result.error) {
      case 'not_enough_dragonballs':
        return 'Not enough DragonBalls.'
      case 'not_enough_meteors':
        return 'Not enough Meteors.'
      case 'already_max_quality':
        return 'Already at Super quality.'
      case 'already_max_level':
        return 'Already at the level cap.'
      case 'not_owner':
      case 'item_not_found':
        return "Couldn't find that item."
      default:
        return 'Something went wrong.'
    }
  }

  return result.upgraded ? `${successNoun} succeeded!` : `${successNoun} failed — materials were still spent.`
}

export default function ForgePanel() {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const meteors = useCurrencyStore((state) => state.meteors)
  const dragonballs = useCurrencyStore((state) => state.dragonballs)
  const busy = useForgeStore((state) => state.busy)
  const qualityUpgrade = useForgeStore((state) => state.qualityUpgrade)
  const levelUpgrade = useForgeStore((state) => state.levelUpgrade)

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const selectedItem = items.find((item) => item.id === selectedItemId)
  const selectedTemplate = selectedItem && templates.find((t) => t.id === selectedItem.template_id)

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 text-center text-sm text-slate-500">
        No items to forge yet — defeat enemies for a chance at a drop.
      </div>
    )
  }

  const isMaxQuality = selectedItem?.quality_tier === 'super'
  const isMaxLevel = (selectedItem?.level ?? 0) >= ITEM_LEVEL_CAP

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
        <dl className="grid grid-cols-2 gap-2 text-sm text-slate-300">
          <div className="flex justify-between">
            <dt className="text-slate-400">Meteors</dt>
            <dd>{meteors}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">DragonBalls</dt>
            <dd>{dragonballs}</dd>
          </div>
        </dl>
      </div>

      <div className="space-y-2">
        {items.map((item) => {
          const template = templates.find((t) => t.id === item.template_id)
          const isSelected = item.id === selectedItemId

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSelectedItemId(item.id)
                setStatusMessage(null)
              }}
              className={`w-full rounded-xl border p-3 text-left text-sm ${
                isSelected
                  ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                  : 'border-slate-800 bg-slate-950/80 text-slate-300 hover:border-slate-600'
              }`}
            >
              <p className="flex items-center gap-2 font-medium">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: getQualityColor(item.quality_tier) }}
                />
                {template ? formatItemDisplayName(template.name, item.quality_tier) : 'Unknown item'}
              </p>
              <p className="text-xs text-slate-500">{formatQualityAndLevel(item.quality_tier, item.level)}</p>
            </button>
          )
        })}
      </div>

      {selectedItem && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-lg"
              style={{ borderColor: getQualityColor(selectedItem.quality_tier) }}
            >
              🗡️
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {selectedTemplate ? formatItemDisplayName(selectedTemplate.name, selectedItem.quality_tier) : 'Unknown item'}
              </p>
              <p className="text-xs text-slate-500">
                {formatQualityAndLevel(selectedItem.quality_tier, selectedItem.level)}
              </p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || isMaxQuality}
              onClick={async () => {
                const result = await qualityUpgrade(selectedItem.id)
                setStatusMessage(describeResult(result, 'Quality upgrade'))
              }}
              className="flex-1 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isMaxQuality
                ? 'Upgrade Quality (Max)'
                : `Upgrade Quality (${previewQualityUpgradeCost(selectedItem.quality_tier)} DragonBall)`}
            </button>

            <button
              type="button"
              disabled={busy || isMaxLevel}
              onClick={async () => {
                const result = await levelUpgrade(selectedItem.id)
                setStatusMessage(describeResult(result, 'Level upgrade'))
              }}
              className="flex-1 rounded-lg border border-amber-500 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isMaxLevel ? 'Upgrade Level (Max)' : `Upgrade Level (${previewLevelUpgradeCost(selectedItem.level)} Meteor)`}
            </button>
          </div>

          {statusMessage && <p className="mt-3 text-center text-xs text-slate-400">{statusMessage}</p>}
        </div>
      )}
    </div>
  )
}
