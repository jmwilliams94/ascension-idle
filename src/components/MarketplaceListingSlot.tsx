import InventorySlot, { SLOT_LABEL_HEIGHT_CLASS, SLOT_SIZE_CLASS, SLOT_WIDTH_CLASS } from './InventorySlot'
import { useDraggableTile } from './dragDropContext'
import { buildGearTooltip, formatItemDisplayName, formatItemLevel, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

interface MarketplaceListingSlotProps {
  item: ItemInstance | null
  template: ItemTemplate | null
  onRemove: () => void
}

// The drop target for "List an Item" (see MarketplacePanel) — structurally
// mirrors ForgeUpgradeSlot.tsx exactly (single drop target, data-drop-zone
// carries the target key a dragged tile lands on, reuses InventorySlot so the
// universal hover tooltip works here too). A small, deliberate duplication
// rather than a shared generic component, matching this codebase's existing
// style (ForgeUpgradeSlot/WarehouseGrid already have some duplication rather
// than an over-abstracted shared slot).
export default function MarketplaceListingSlot({ item, template, onRemove }: MarketplaceListingSlotProps) {
  const icon = getItemIcon(template?.slot_type)
  const drag = useDraggableTile({
    enabled: Boolean(item),
    payload: item ? { id: item.id, icon, qualityColor: getQualityColor(item.quality_tier) } : null,
    onDrop: () => onRemove(),
  })

  return (
    <div className={`flex flex-col items-center gap-2 ${SLOT_WIDTH_CLASS}`}>
      <div className={`flex ${SLOT_LABEL_HEIGHT_CLASS} items-center justify-center`}>
        <p className="text-center text-[10px] uppercase leading-tight tracking-wide text-slate-500">List for Sale</p>
      </div>

      <div data-drop-zone="marketplace-listing" className={`${SLOT_SIZE_CLASS} shrink-0`}>
        <InventorySlot
          slotId="marketplace-listing-slot"
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
          <p className="text-[10px] text-slate-500">{formatItemLevel(item.level)}</p>
          <button type="button" onClick={onRemove} className="mt-1 text-[10px] text-slate-500 underline hover:text-slate-300">
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
