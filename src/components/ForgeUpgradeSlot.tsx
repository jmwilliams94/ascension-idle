import type { DragEvent } from 'react'
import InventorySlot from './InventorySlot'
import { buildGearTooltip, formatItemDisplayName, formatQualityAndLevel, getQualityColor } from '../game/items/equipmentBonus'
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
// anyone who'd rather click than drag. Reuses InventorySlot (rather than its own
// bespoke tile markup) so the universal hover tooltip works here too.
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

      <div onDragOver={handleDragOver} onDrop={handleDrop} className="h-20 w-20 shrink-0">
        <InventorySlot
          slotId="forge-upgrade-slot"
          filled={Boolean(item)}
          sizeClassName="h-20 w-20"
          emptyHint="Drop item here"
          qualityColor={item ? getQualityColor(item.quality_tier) : undefined}
          icon={item ? '🗡️' : undefined}
          label={item ? (template ? formatItemDisplayName(template.name, item.quality_tier) : 'Unknown item') : undefined}
          tooltip={item ? buildGearTooltip(item, template ?? undefined) : undefined}
          draggable={Boolean(item)}
          onDragEnd={item ? onRemove : undefined}
        />
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
