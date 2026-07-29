import EquipmentSlot from './EquipmentSlot'
import { buildGearTooltip, getQualityColor } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

const SLOT_SIZE = 'h-10 w-10'

// Compact at-a-glance summary of equipped gear, shown above the full paper-doll
// on the Equipment tab (see EquipmentTabPage). No longer opens anything on click —
// that only made sense back when this sat in a persistent sidebar next to a
// canvas and the full paper-doll lived in a separate overlay; now they're both on
// the same page, so this is just a glance, not a shortcut.
export default function EquipmentBar() {
  const equippedItemId = useEquipmentStore((state) => state.equippedItemId)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)

  const equippedItem = items.find((item) => item.id === equippedItemId)
  const template = equippedItem && templates.find((entry) => entry.id === equippedItem.template_id)

  return (
    <div className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-left">
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
          sizeClassName={SLOT_SIZE}
        />
        <EquipmentSlot label="Boots" icon="👢" locked sizeClassName={SLOT_SIZE} />
        <EquipmentSlot label="Off-hand / Shield" icon="🛡️" locked sizeClassName={SLOT_SIZE} />
        <EquipmentSlot label="Armor" icon="🥋" locked sizeClassName={SLOT_SIZE} />
      </div>
    </div>
  )
}
