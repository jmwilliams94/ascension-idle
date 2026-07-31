import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { buildGearTooltip, formatItemDisplayName, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import { buildStoneTooltip, compositionPointValue } from '../game/items/forgeCosts'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

// Fed as either a real gear item (destroyed on Feed) or a single stone (stones
// don't stack — each slot holds at most one stone; feeding more of the same tier
// means using the other slot too) — both are just "fuel" once placed here,
// distinguished only by how they're rendered/valued.
export type FuelEntry = { kind: 'item'; id: string; item: ItemInstance } | { kind: 'stone'; id: string; tier: number }

const FUEL_SLOT_COUNT = 2

interface ForgeFuelSlotsProps {
  // Fixed-length (FUEL_SLOT_COUNT) — a null entry means that slot is empty.
  slots: (FuelEntry | null)[]
  templates: ItemTemplate[]
  onRemoveSlot: (slotIndex: number) => void
}

// Exactly two fixed drop targets (not an unbounded list) — confirmed: Composition
// feeds are capped at two fuel inputs at a time. Each wrapper carries
// data-drop-zone="fuel-<index>" (see dragDrop.tsx) so a tile dragged from the
// Inventory grid can land here — the actual drop is handled by ForgePanel via
// that grid tile's own drag hook, not from anything in this component.
export default function ForgeFuelSlots({ slots, templates, onRemoveSlot }: ForgeFuelSlotsProps) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">Fuel ({FUEL_SLOT_COUNT} slots)</p>
      <div className="mt-1 flex gap-2">
        {Array.from({ length: FUEL_SLOT_COUNT }, (_, index) => {
          const entry = slots[index] ?? null
          const dropKey = `fuel-${index}`

          if (!entry) {
            return (
              <div key={index} data-drop-zone={dropKey} className={SLOT_SIZE_CLASS}>
                <InventorySlot slotId={`fuel-slot-${index}`} filled={false} sizeClassName={SLOT_SIZE_CLASS} emptyHint="Drop stone or item" />
              </div>
            )
          }

          if (entry.kind === 'stone') {
            const value = compositionPointValue(entry.tier)

            return (
              <div key={index} data-drop-zone={dropKey} className={SLOT_SIZE_CLASS}>
                <InventorySlot
                  slotId={`fuel-slot-${index}`}
                  filled
                  sizeClassName={SLOT_SIZE_CLASS}
                  icon="🔷"
                  badge={`${value}`}
                  label={`+${entry.tier} Stone`}
                  tooltip={buildStoneTooltip(entry.tier)}
                  onClick={() => onRemoveSlot(index)}
                />
              </div>
            )
          }

          const template = templates.find((t) => t.id === entry.item.template_id)

          return (
            <div key={index} data-drop-zone={dropKey} className={SLOT_SIZE_CLASS}>
              <InventorySlot
                slotId={`fuel-slot-${index}`}
                filled
                sizeClassName={SLOT_SIZE_CLASS}
                icon={getItemIcon(template?.slot_type)}
                badge={`${compositionPointValue(entry.item.composition_level)}`}
                qualityColor={getQualityColor(entry.item.quality_tier)}
                label={template ? formatItemDisplayName(template.name, entry.item.quality_tier, entry.item.composition_level) : 'Unknown item'}
                tooltip={buildGearTooltip(entry.item, template)}
                onClick={() => onRemoveSlot(index)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
