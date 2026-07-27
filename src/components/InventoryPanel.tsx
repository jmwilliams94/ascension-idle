import { useState } from 'react'
import InventorySlot from './InventorySlot'
import { formatBaseStats, formatItemDisplayName, formatQualityAndLevel, getQualityColor } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { INVENTORY_SLOT_CAP, useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { ARROW_TYPES } from '../game/items/arrowTypes'

// Gear (item_instances) renders as a fixed 40-cell grid — always all 40 cells, empty
// ones dimmed — since Forge's upcoming drag-and-drop step needs a stable, always-
// present set of slots to pick items up from (see INVENTORY_SLOT_CAP). Arrow stacks
// are a separate ammo system (own table, own per-stack caps, never touched by Forge)
// and keep their own list section above the grid, unchanged from before.
export default function InventoryPanel() {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const equippedItemId = useEquipmentStore((state) => state.equippedItemId)
  const setEquippedItemId = useEquipmentStore((state) => state.setEquippedItemId)

  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const arrowStacks = useArrowStore((state) => state.stacks)
  const equippedStackId = useArrowStore((state) => state.equippedStackId)
  const setEquippedStackId = useArrowStore((state) => state.setEquippedStackId)

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  const isHunter = selectedClassId === 'hunter'
  // Empty (fully depleted) stacks stay in the DB so the debounced autosave doesn't
  // need insert/delete diffing (see useArrowStore) — hide them from view here.
  const visibleArrowStacks = isHunter ? arrowStacks.filter((stack) => stack.count > 0) : []

  const selectedItem = items.find((item) => item.id === selectedItemId)
  const selectedTemplate = selectedItem && templates.find((entry) => entry.id === selectedItem.template_id)
  const emptySlotCount = Math.max(0, INVENTORY_SLOT_CAP - items.length)

  return (
    <div className="space-y-4">
      {visibleArrowStacks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Arrows</p>

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
        </div>
      )}

      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Items ({items.length}/{INVENTORY_SLOT_CAP})
        </p>

        <div className="mt-2 grid grid-cols-8 gap-1.5">
          {items.map((item) => {
            const template = templates.find((entry) => entry.id === item.template_id)
            const label = template ? formatItemDisplayName(template.name, item.quality_tier) : 'Unknown item'

            return (
              <InventorySlot
                key={item.id}
                slotId={item.id}
                filled
                qualityColor={getQualityColor(item.quality_tier)}
                icon="🗡️"
                label={label}
                selected={item.id === selectedItemId}
                onClick={() => setSelectedItemId((current) => (current === item.id ? null : item.id))}
              />
            )
          })}

          {Array.from({ length: emptySlotCount }, (_, index) => (
            <InventorySlot key={`empty-${index}`} slotId={`empty-${index}`} filled={false} />
          ))}
        </div>
      </div>

      {selectedItem && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
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
              <p className="text-xs text-slate-500">{formatQualityAndLevel(selectedItem.quality_tier, selectedItem.level)}</p>
              {selectedTemplate && <p className="text-xs text-slate-500">{formatBaseStats(selectedTemplate.base_stats)}</p>}
            </div>
          </div>

          <button
            type="button"
            disabled={selectedItem.id === equippedItemId}
            onClick={() => setEquippedItemId(selectedItem.id)}
            className={`mt-3 w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
              selectedItem.id === equippedItemId
                ? 'cursor-not-allowed border-slate-800 text-slate-600'
                : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
            }`}
          >
            {selectedItem.id === equippedItemId ? 'Equipped' : 'Equip'}
          </button>
        </div>
      )}
    </div>
  )
}
