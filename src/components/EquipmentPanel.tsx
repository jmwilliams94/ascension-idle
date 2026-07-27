import { formatBaseStats, formatQualityAndLevel } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

// Just the weapon slot for now, matching the seeded item's slot_type — see the
// equipped_item_id column note (single-slot shortcut) for why this doesn't
// generalize to multiple slots yet.
export default function EquipmentPanel() {
  const equippedItemId = useEquipmentStore((state) => state.equippedItemId)
  const setEquippedItemId = useEquipmentStore((state) => state.setEquippedItemId)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)

  const equippedItem = items.find((entry) => entry.id === equippedItemId)
  const template = equippedItem && templates.find((entry) => entry.id === equippedItem.template_id)

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">Weapon</p>

      {template ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-lg">
              🗡️
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">{template.name}</p>
              <p className="text-xs text-slate-500">{formatQualityAndLevel(equippedItem.quality_tier, equippedItem.level)}</p>
              <p className="text-xs text-slate-500">{formatBaseStats(template.base_stats)}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setEquippedItemId(null)}
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500"
          >
            Unequip
          </button>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">Nothing equipped</p>
      )}
    </div>
  )
}
