import type { DragEvent } from 'react'
import { compositionPointValue } from '../game/items/forgeCosts'
import { getQualityColor } from '../game/items/equipmentBonus'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

interface ForgeFuelZoneProps {
  fuelItems: ItemInstance[]
  templates: ItemTemplate[]
  onDropItemId: (itemId: string) => void
  onRemove: (itemId: string) => void
}

// A second drop target, distinct from the main Upgrade Slot — this one holds gear
// sacrificed for its composition value rather than the item being upgraded, and
// accepts any number of items (each removable individually via a click, simpler
// than requiring drag-precision for something with no single "home" position).
export default function ForgeFuelZone({ fuelItems, templates, onDropItemId, onRemove }: ForgeFuelZoneProps) {
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
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">Fuel</p>
      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="mt-1 flex min-h-14 flex-wrap gap-1.5 rounded-lg border border-dashed border-slate-700 bg-slate-950/40 p-2"
      >
        {fuelItems.length === 0 && (
          <span className="self-center px-1 text-[10px] leading-tight text-slate-600">
            Drag items here to feed as fuel
          </span>
        )}

        {fuelItems.map((item) => {
          const template = templates.find((entry) => entry.id === item.template_id)
          const value = compositionPointValue(item.composition_level)

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onRemove(item.id)}
              title={`${template?.name ?? 'Unknown item'} — worth ${value} pts (click to remove)`}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded border-2 bg-slate-800 text-sm"
              style={{ borderColor: getQualityColor(item.quality_tier) }}
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
