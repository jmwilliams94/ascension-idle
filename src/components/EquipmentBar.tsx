import EquipmentSlot from './EquipmentSlot'
import { buildGearTooltip, getQualityColor } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useOverlayStore } from '../game/hud/useOverlayStore'

const SLOT_SIZE = 'h-10 w-10'

// Always-visible, compact summary of equipped gear — sits at the top of SideHud
// where the Class card used to be. Clicking anywhere on the bar opens the full
// Equipment overlay (paper-doll + stats); this is a shortcut, not a replacement.
export default function EquipmentBar() {
  const equippedItemId = useEquipmentStore((state) => state.equippedItemId)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const openOverlay = useOverlayStore((state) => state.open)

  const equippedItem = items.find((item) => item.id === equippedItemId)
  const template = equippedItem && templates.find((entry) => entry.id === equippedItem.template_id)

  const handleOpen = () => openOverlay('equipment')

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') handleOpen()
      }}
      className="w-full cursor-pointer rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-left transition-colors hover:border-slate-600"
    >
      <p className="text-sm font-medium text-slate-200">Equipment</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <EquipmentSlot label="Head" icon="🪖" locked sizeClassName={SLOT_SIZE} />
        <EquipmentSlot label="Necklace" icon="📿" locked sizeClassName={SLOT_SIZE} />
        <EquipmentSlot label="Ring" icon="💍" locked sizeClassName={SLOT_SIZE} />
        <EquipmentSlot
          label={equippedItem ? 'Main Hand' : 'Main Hand — empty'}
          icon={equippedItem ? '🗡️' : undefined}
          filled={Boolean(equippedItem)}
          qualityColor={equippedItem ? getQualityColor(equippedItem.quality_tier) : undefined}
          tooltip={equippedItem ? buildGearTooltip(equippedItem, template ?? undefined) : undefined}
          onClick={handleOpen}
          sizeClassName={SLOT_SIZE}
        />
        <EquipmentSlot label="Boots" icon="👢" locked sizeClassName={SLOT_SIZE} />
        <EquipmentSlot label="Off-hand / Shield" icon="🛡️" locked sizeClassName={SLOT_SIZE} />
        <EquipmentSlot label="Armor" icon="🥋" locked sizeClassName={SLOT_SIZE} />
      </div>
    </div>
  )
}
