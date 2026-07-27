import { formatBaseStats, formatItemDisplayName, formatQualityAndLevel, getQualityColor } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { ARROW_TYPES } from '../game/items/arrowTypes'

export default function InventoryPanel() {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const equippedItemId = useEquipmentStore((state) => state.equippedItemId)
  const setEquippedItemId = useEquipmentStore((state) => state.setEquippedItemId)

  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const arrowStacks = useArrowStore((state) => state.stacks)
  const equippedStackId = useArrowStore((state) => state.equippedStackId)
  const setEquippedStackId = useArrowStore((state) => state.setEquippedStackId)

  const isHunter = selectedClassId === 'hunter'
  // Empty (fully depleted) stacks stay in the DB so the debounced autosave doesn't
  // need insert/delete diffing (see useArrowStore) — hide them from view here.
  const visibleArrowStacks = isHunter ? arrowStacks.filter((stack) => stack.count > 0) : []

  if (items.length === 0 && visibleArrowStacks.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 text-center text-sm text-slate-500">
        No items yet — defeat enemies for a chance at a drop.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {visibleArrowStacks.map((stack) => {
        const type = ARROW_TYPES[stack.arrowType]
        const isEquipped = stack.id === equippedStackId

        return (
          <div
            key={stack.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg">
                🏹
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">{type.displayName}</p>
                <p className="text-xs text-slate-500">
                  {stack.count} / {type.stackSize}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={isEquipped}
              onClick={() => setEquippedStackId(stack.id)}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                isEquipped
                  ? 'cursor-not-allowed border-slate-800 text-slate-600'
                  : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
              }`}
            >
              {isEquipped ? 'Equipped' : 'Equip'}
            </button>
          </div>
        )
      })}

      {items.map((item) => {
        const template = templates.find((entry) => entry.id === item.template_id)
        const isEquipped = item.id === equippedItemId

        return (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3"
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-lg"
                style={{ borderColor: getQualityColor(item.quality_tier) }}
              >
                🗡️
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">
                  {template ? formatItemDisplayName(template.name, item.quality_tier) : 'Unknown item'}
                </p>
                <p className="text-xs text-slate-500">{formatQualityAndLevel(item.quality_tier, item.level)}</p>
                {template && <p className="text-xs text-slate-500">{formatBaseStats(template.base_stats)}</p>}
              </div>
            </div>

            <button
              type="button"
              disabled={isEquipped}
              onClick={() => setEquippedItemId(item.id)}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                isEquipped
                  ? 'cursor-not-allowed border-slate-800 text-slate-600'
                  : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
              }`}
            >
              {isEquipped ? 'Equipped' : 'Equip'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
