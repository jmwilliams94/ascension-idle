import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { useDraggableTile } from './dragDropContext'
import { buildGearTooltip, formatItemDisplayName, formatQualityAndLevel, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

interface ForgeUpgradeSlotProps {
  item: ItemInstance | null
  template: ItemTemplate | null
  onRemove: () => void
}

// The drop target for Forge's drag-and-drop flow (see dragDrop.tsx) — its
// wrapper carries data-drop-zone="upgrade" so a tile dragged from the
// Inventory grid can land here; onDropItemId is invoked by ForgePanel via that
// grid tile's own drag hook, not from anything in this component. Occupied,
// the item itself becomes draggable so dragging it back out clears the
// selection — there's nowhere else valid to drop it, so it's removed
// regardless of where the drag ends, same as a "Remove" click. Reuses
// InventorySlot (rather than its own bespoke tile markup) so the universal
// hover tooltip works here too.
export default function ForgeUpgradeSlot({ item, template, onRemove }: ForgeUpgradeSlotProps) {
  const icon = getItemIcon(template?.slot_type)
  const drag = useDraggableTile({
    enabled: Boolean(item),
    payload: item ? { id: item.id, icon, qualityColor: getQualityColor(item.quality_tier) } : null,
    onDrop: () => onRemove(),
  })

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">Upgrade Slot</p>

      <div data-drop-zone="upgrade" className={`${SLOT_SIZE_CLASS} shrink-0`}>
        <InventorySlot
          slotId="forge-upgrade-slot"
          filled={Boolean(item)}
          sizeClassName={SLOT_SIZE_CLASS}
          emptyHint="Drop item here"
          qualityColor={item ? getQualityColor(item.quality_tier) : undefined}
          icon={item ? icon : undefined}
          label={item ? (template ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level) : 'Unknown item') : undefined}
          tooltip={item ? buildGearTooltip(item, template ?? undefined) : undefined}
          draggable={drag.draggable}
          dragging={drag.dragging}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          onPointerCancel={drag.onPointerCancel}
        />
      </div>

      {item && (
        <div className="text-center">
          <p className="text-xs font-medium text-slate-200">
            {template ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level) : 'Unknown item'}
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
