import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { buildGearTooltip, getGearIconSrc, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { EQUIP_SLOTS, useEquipmentStore, type EquipSlot } from '../game/items/useEquipmentStore'

const EQUIP_SLOT_LABELS: Record<Exclude<EquipSlot, 'quiver'>, string> = {
  weapon: 'Main Hand',
  ring: 'Ring',
  necklace: 'Necklace',
  boots: 'Boots',
  hat: 'Head',
  coat: 'Armor',
}

interface EquippedGearPickerProps {
  onSelect: (itemId: string) => void
}

// Shared "or pick an equipped item" row (2026-08-14, extracted from
// MasterForgePanel so every Forge tool can offer it, not just Master Forge —
// every Forge tool otherwise only accepts drags from the Inventory grid,
// which never shows equipped gear, forcing an unequip first). Quiver is
// always excluded — it has no stats/upgrade chain and shouldn't be offered
// in any Forge tool.
export default function EquippedGearPicker({ onSelect }: EquippedGearPickerProps) {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const equippedIds = useEquipmentStore((state) => state.equippedIds)

  const entries = EQUIP_SLOTS.filter((slot): slot is Exclude<EquipSlot, 'quiver'> => slot !== 'quiver')
    .map((slot) => ({ slot, itemId: equippedIds[slot] }))
    .filter((entry): entry is { slot: Exclude<EquipSlot, 'quiver'>; itemId: string } => Boolean(entry.itemId))

  if (entries.length === 0) {
    return null
  }

  return (
    <div className="w-full max-w-sm">
      <p className="mb-1 text-center text-[10px] uppercase tracking-wide text-slate-500">Or pick an equipped item</p>
      <div className="flex flex-wrap justify-center gap-2">
        {entries.map(({ slot, itemId }) => {
          const item = items.find((entry) => entry.id === itemId) ?? null
          const template = item ? (templates.find((t) => t.id === item.template_id) ?? null) : null
          return (
            <div key={slot} className="flex flex-col items-center gap-1">
              <InventorySlot
                slotId={`equipped-${slot}`}
                filled={Boolean(item)}
                sizeClassName={SLOT_SIZE_CLASS}
                icon={getItemIcon(template?.slot_type)}
                iconSrc={getGearIconSrc(template?.name)}
                qualityColor={item ? getQualityColor(item.quality_tier) : undefined}
                tooltip={item ? buildGearTooltip(item, template ?? undefined) : undefined}
                label={EQUIP_SLOT_LABELS[slot]}
                onClick={() => item && onSelect(itemId)}
              />
              <span className="text-[9px] text-slate-500">{EQUIP_SLOT_LABELS[slot]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
