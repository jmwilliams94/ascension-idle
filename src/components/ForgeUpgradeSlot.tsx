import type { DragEvent } from 'react'
import { formatItemDisplayName, formatQualityAndLevel, getQualityColor } from '../game/items/equipmentBonus'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

interface ForgeUpgradeSlotProps {
  item: ItemInstance | null
  template: ItemTemplate | null
  onDropItemId: (itemId: string) => void
  onRemove: () => void
}

// The drop target for Forge's drag-and-drop flow. Empty, it accepts a drag from
// the Inventory grid (native HTML5 DnD — see InventoryPanel's onItemDragStart).
// Occupied, the item itself becomes draggable so dragging it back out clears the
// selection (there's nowhere else valid to drop it, so onDragEnd always clears,
// regardless of where the drag ends) — a "Remove" button does the same thing for
// anyone who'd rather click than drag.
export default function ForgeUpgradeSlot({ item, template, onDropItemId, onRemove }: ForgeUpgradeSlotProps) {
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const itemId = event.dataTransfer.getData('text/plain')
    if (itemId) {
      onDropItemId(itemId)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">Upgrade Slot</p>

      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border-2 text-2xl ${
          item ? 'bg-slate-800' : 'border-dashed border-slate-700 bg-slate-950/40'
        }`}
        style={item ? { borderColor: getQualityColor(item.quality_tier), backgroundColor: `${getQualityColor(item.quality_tier)}22` } : undefined}
      >
        {item ? (
          <button
            type="button"
            draggable
            onDragEnd={onRemove}
            title="Drag out to remove"
            aria-label="Drag out to remove from Upgrade Slot"
            className="flex h-full w-full cursor-grab items-center justify-center active:cursor-grabbing"
          >
            🗡️
          </button>
        ) : (
          <span className="px-1 text-center text-[10px] leading-tight text-slate-600">Drop item here</span>
        )}
      </div>

      {item && (
        <div className="text-center">
          <p className="text-xs font-medium text-slate-200">
            {template ? formatItemDisplayName(template.name, item.quality_tier) : 'Unknown item'}
          </p>
          <p className="text-[10px] text-slate-500">{formatQualityAndLevel(item.quality_tier, item.level)}</p>
          <button
            type="button"
            onClick={onRemove}
            className="mt-1 text-[10px] text-slate-500 underline hover:text-slate-300"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
