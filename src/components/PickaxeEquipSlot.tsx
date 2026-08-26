import InventorySlot, { SLOT_LABEL_HEIGHT_CLASS, SLOT_SIZE_CLASS, SLOT_WIDTH_CLASS } from './InventorySlot'
import { useDraggableTile, useIsDropTarget } from './dragDropContext'
import { buildGearTooltip, formatItemDisplayName, getGearIconSrc, getQualityColor } from '../game/items/equipmentBonus'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

export const MINING_PICKAXE_DROP_ZONE = 'mining-pickaxe'

interface PickaxeEquipSlotProps {
  item: ItemInstance | null
  template: ItemTemplate | null
  onUnequip: () => void
}

// Mining tab's own equip slot (2026-10-24, requested by the user) — mirrors
// ForgeUpgradeSlot.tsx's exact drag-and-drop shape (InventorySlot +
// useDraggableTile + useIsDropTarget), but for equipping a Pickaxe
// independent of the character's real weapon slot. Drag a Pickaxe-family
// tile from the Inventory grid below (CombatPage.tsx's handleMiningTileDrop
// resolves the drop into equipPickaxe) onto MINING_PICKAXE_DROP_ZONE to
// equip; drag the equipped tile back out, or tap the "Unequip" link below
// it, to unequip — same "drag back out clears it" convention
// ForgeUpgradeSlot's own Remove link established.
export default function PickaxeEquipSlot({ item, template, onUnequip }: PickaxeEquipSlotProps) {
  const iconSrc = getGearIconSrc(template?.name, item?.quality_tier)
  const drag = useDraggableTile({
    enabled: Boolean(item),
    payload: item ? { id: item.id, icon: '⛏️', iconSrc, qualityColor: getQualityColor(item.quality_tier) } : null,
    onDrop: () => onUnequip(),
  })
  const isDropTarget = useIsDropTarget(MINING_PICKAXE_DROP_ZONE)

  return (
    <div className={`flex flex-col items-center gap-2 ${SLOT_WIDTH_CLASS}`}>
      <div className={`flex ${SLOT_LABEL_HEIGHT_CLASS} items-center justify-center`}>
        <p className="text-center text-[10px] uppercase leading-tight tracking-wide text-slate-500">Pickaxe Slot</p>
      </div>

      <div
        data-drop-zone={MINING_PICKAXE_DROP_ZONE}
        className={`${SLOT_SIZE_CLASS} shrink-0 rounded-lg transition-shadow ${
          isDropTarget ? 'ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]' : ''
        }`}
      >
        <InventorySlot
          slotId="mining-pickaxe-slot"
          filled={Boolean(item)}
          sizeClassName={SLOT_SIZE_CLASS}
          emptyHint="Drop Pickaxe here"
          qualityColor={item ? getQualityColor(item.quality_tier) : undefined}
          icon={item ? '⛏️' : undefined}
          iconSrc={item ? iconSrc : undefined}
          compositionLevel={item?.composition_level}
          label={item && template ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level) : undefined}
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
        <button type="button" onClick={onUnequip} className="text-[10px] text-slate-500 underline hover:text-slate-300">
          Unequip
        </button>
      )}
    </div>
  )
}
