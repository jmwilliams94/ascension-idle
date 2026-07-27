import { formatBaseStats, formatItemDisplayName, formatQualityAndLevel, getQualityColor } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

export default function InventoryPanel() {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const equippedItemId = useEquipmentStore((state) => state.equippedItemId)
  const setEquippedItemId = useEquipmentStore((state) => state.setEquippedItemId)

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 text-center text-sm text-slate-500">
        No items yet — defeat enemies for a chance at a drop.
      </div>
    )
  }

  return (
    <div className="space-y-2">
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
