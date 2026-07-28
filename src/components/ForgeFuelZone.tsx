import type { DragEvent } from 'react'
import { compositionPointValue } from '../game/items/forgeCosts'
import { getQualityColor } from '../game/items/equipmentBonus'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

// Fed as either a real gear item (destroyed on Feed) or a stone tier (its entire
// current count fed at once, see stoneDragId) — both are just "fuel" once dropped
// here, distinguished only by how they're rendered/valued.
export type FuelEntry = { kind: 'item'; id: string; item: ItemInstance } | { kind: 'stone'; id: string; tier: number; count: number }

interface ForgeFuelZoneProps {
  fuelEntries: FuelEntry[]
  templates: ItemTemplate[]
  onDropItemId: (id: string) => void
  onRemove: (id: string) => void
}

// A second drop target, distinct from the main Upgrade Slot — this one holds gear
// and/or stones sacrificed for their composition value rather than the item being
// upgraded, and accepts any number of items (each removable individually via a
// click, simpler than requiring drag-precision for something with no single "home"
// position).
export default function ForgeFuelZone({ fuelEntries, templates, onDropItemId, onRemove }: ForgeFuelZoneProps) {
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const id = event.dataTransfer.getData('text/plain')
    if (id) {
      onDropItemId(id)
    }
  }

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">Fuel</p>
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="mt-1 flex min-h-14 flex-wrap gap-1.5 rounded-lg border border-dashed border-slate-700 bg-slate-950/40 p-2"
      >
        {fuelEntries.length === 0 && (
          <span className="self-center px-1 text-[10px] leading-tight text-slate-600">
            Drag items or stones here to feed as fuel
          </span>
        )}

        {fuelEntries.map((entry) => {
          if (entry.kind === 'stone') {
            const value = compositionPointValue(entry.tier) * entry.count

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onRemove(entry.id)}
                title={`+${entry.tier} Stone ×${entry.count} — worth ${value} pts total (click to remove)`}
                className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded border-2 border-slate-700 bg-slate-800 text-sm"
              >
                🔷
                <span className="absolute -bottom-1 -right-1 rounded bg-slate-900 px-0.5 text-[8px] font-semibold text-slate-300">
                  {value}
                </span>
              </button>
            )
          }

          const template = templates.find((t) => t.id === entry.item.template_id)
          const value = compositionPointValue(entry.item.composition_level)

          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onRemove(entry.id)}
              title={`${template?.name ?? 'Unknown item'} — worth ${value} pts (click to remove)`}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded border-2 bg-slate-800 text-sm"
              style={{ borderColor: getQualityColor(entry.item.quality_tier) }}
            >
              🗡️
              <span className="absolute -bottom-1 -right-1 rounded bg-slate-900 px-0.5 text-[8px] font-semibold text-slate-300">
                {value}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
