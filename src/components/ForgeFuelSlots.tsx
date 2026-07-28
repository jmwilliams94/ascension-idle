import type { DragEvent } from 'react'
import InventorySlot from './InventorySlot'
import { buildGearTooltip, formatItemDisplayName, getQualityColor } from '../game/items/equipmentBonus'
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
  onDropSlot: (slotIndex: number, id: string) => void
  onRemoveSlot: (slotIndex: number) => void
}

// Exactly two fixed drop targets (not an unbounded list) — confirmed: Composition
// feeds are capped at two fuel inputs at a time, each independently accepting a
// drag from the Inventory grid (a stone tile or a gear tile).
export default function ForgeFuelSlots({ slots, templates, onDropSlot, onRemoveSlot }: ForgeFuelSlotsProps) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">Fuel ({FUEL_SLOT_COUNT} slots)</p>
      <div className="mt-1 flex gap-2">
        {Array.from({ length: FUEL_SLOT_COUNT }, (_, index) => {
          const entry = slots[index] ?? null

          const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
          }

          const handleDrop = (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault()
            const id = event.dataTransfer.getData('text/plain')
            if (id) {
              onDropSlot(index, id)
            }
          }

          if (!entry) {
            return (
              <div key={index} onDragOver={handleDragOver} onDrop={handleDrop} className="h-14 w-14">
                <InventorySlot slotId={`fuel-slot-${index}`} filled={false} sizeClassName="h-14 w-14" emptyHint="Drop stone or item" />
              </div>
            )
          }

          if (entry.kind === 'stone') {
            const value = compositionPointValue(entry.tier)

            return (
              <div key={index} onDragOver={handleDragOver} onDrop={handleDrop} className="h-14 w-14">
                <InventorySlot
                  slotId={`fuel-slot-${index}`}
                  filled
                  sizeClassName="h-14 w-14"
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
            <div key={index} onDragOver={handleDragOver} onDrop={handleDrop} className="h-14 w-14">
              <InventorySlot
                slotId={`fuel-slot-${index}`}
                filled
                sizeClassName="h-14 w-14"
                icon="🗡️"
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
