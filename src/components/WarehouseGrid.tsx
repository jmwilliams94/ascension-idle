import { useState } from 'react'
import type { DragEvent } from 'react'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import type { ItemTooltipData } from '../game/items/itemTooltip'
import { formatCompositionTier } from '../game/items/forgeCosts'
import { formatItemDisplayName } from '../game/items/equipmentBonus'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { WAREHOUSE_SLOT_CAP, useWarehouseStore } from '../game/items/useWarehouseStore'

// The Warehouse's own 40-slot grid — a thin sibling of InventoryPanel, not the
// same component, since a warehoused gear "token" (one row per template+tier,
// fungible, shown with a count badge) has different fill/stack rules than a raw
// Inventory gear item (non-stacking, one instance per slot). Stone tiles here are
// purely a slot-accounting display (each occupies one Warehouse slot, mirroring
// how Inventory itself counts composition_stones) — depositing/withdrawing
// stones happens via the amount-input rows in WarehousePanel, not this grid.
interface WarehouseGridProps {
  characterId: string
}

export default function WarehouseGrid({ characterId }: WarehouseGridProps) {
  const items = useWarehouseStore((state) => state.items)
  const stones = useWarehouseStore((state) => state.stones)
  const busy = useWarehouseStore((state) => state.busy)
  const fullMessage = useWarehouseStore((state) => state.fullMessage)
  const depositItem = useWarehouseStore((state) => state.depositItem)
  const withdrawItem = useWarehouseStore((state) => state.withdrawItem)
  const clearFullMessage = useWarehouseStore((state) => state.clearFullMessage)
  const templates = useItemTemplatesStore((state) => state.templates)

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  const stoneTiles: { key: string; tier: number }[] = []
  for (const [tierKey, count] of Object.entries(stones)) {
    for (let i = 0; i < count; i += 1) {
      stoneTiles.push({ key: `${tierKey}-${i}`, tier: Number(tierKey) })
    }
  }

  const occupiedCount = items.length + stoneTiles.length
  const emptySlotCount = Math.max(0, WAREHOUSE_SLOT_CAP - occupiedCount)
  const selectedEntry = items.find((entry) => entry.id === selectedEntryId)
  const selectedTemplate = selectedEntry && templates.find((template) => template.id === selectedEntry.template_id)

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const itemId = event.dataTransfer.getData('text/plain')
    if (itemId) {
      void depositItem(characterId, itemId)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Warehouse Storage ({occupiedCount}/{WAREHOUSE_SLOT_CAP})
        </p>

        <div onDragOver={handleDragOver} onDrop={handleDrop} className="mt-2 grid grid-cols-[repeat(8,4rem)] gap-1.5">
          {items.map((entry) => {
            const template = templates.find((t) => t.id === entry.template_id)
            const label = template
              ? formatItemDisplayName(template.name, 'normal', entry.composition_level)
              : 'Unknown item'
            const tooltip: ItemTooltipData = {
              title: label,
              lines: [formatCompositionTier(entry.composition_level), `x${entry.count} in Warehouse`],
            }

            return (
              <InventorySlot
                key={entry.id}
                slotId={entry.id}
                filled
                sizeClassName={SLOT_SIZE_CLASS}
                icon="🗡️"
                label={label}
                tooltip={tooltip}
                badge={`x${entry.count}`}
                selected={selectedEntryId === entry.id}
                onClick={() => setSelectedEntryId((current) => (current === entry.id ? null : entry.id))}
              />
            )
          })}

          {stoneTiles.map(({ key, tier }) => (
            <InventorySlot
              key={key}
              slotId={key}
              filled
              sizeClassName={SLOT_SIZE_CLASS}
              icon="🔷"
              label={`+${tier} Stone (Warehouse)`}
            />
          ))}

          {Array.from({ length: emptySlotCount }, (_, index) => (
            <InventorySlot key={`empty-${index}`} slotId={`wh-empty-${index}`} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
          ))}
        </div>

        {fullMessage && (
          <div className="mt-2 flex items-center justify-between rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
            <span>{fullMessage}</span>
            <button type="button" onClick={clearFullMessage} className="underline hover:text-amber-200">
              Dismiss
            </button>
          </div>
        )}
      </div>

      {selectedEntry && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg">
              🗡️
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {selectedTemplate
                  ? formatItemDisplayName(selectedTemplate.name, 'normal', selectedEntry.composition_level)
                  : 'Unknown item'}
              </p>
              <p className="text-xs text-slate-500">
                {formatCompositionTier(selectedEntry.composition_level)} · x{selectedEntry.count} in Warehouse
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setWithdrawError(null)
              const result = await withdrawItem(characterId, selectedEntry.template_id, selectedEntry.composition_level)
              if (!result.ok) {
                setWithdrawError(result.error === 'inventory_full' ? 'Inventory is full.' : "Couldn't withdraw that item.")
              }
            }}
            className="mt-3 w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Withdraw
          </button>

          {withdrawError && <p className="mt-2 text-xs text-amber-400">{withdrawError}</p>}
        </div>
      )}
    </div>
  )
}
