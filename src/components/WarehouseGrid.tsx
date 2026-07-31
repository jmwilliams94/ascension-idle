import { useState } from 'react'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { DraggableInventorySlot } from './dragDrop'
import { getItemIcon } from '../game/items/equipmentBonus'
import type { ItemTooltipData } from '../game/items/itemTooltip'
import { COMPOSITION_STONE_TIERS, compositionPointValue } from '../game/items/forgeCosts'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { WAREHOUSE_SLOT_CAP, useWarehouseStore } from '../game/items/useWarehouseStore'

// The Warehouse's own 40-slot grid — a thin sibling of InventoryPanel, not the
// same component, since a warehoused gear "token" (one row per template,
// fungible, shown with a count badge) has different fill/stack rules than a raw
// Inventory gear item (non-stacking, one instance per slot). Stones don't occupy
// grid slots here at all — depositing/withdrawing a stone liquidates it into (or
// spends from) the shared Warehouse points balance, so it's a currency-like
// number shown in WarehousePanel, not a physical tile (see useWarehouseStore).
interface WarehouseGridProps {
  characterId: string
  // Dragging a tile *out* of this grid (toward Inventory, to withdraw at the
  // free Normal tier — a shortcut for the common case; choosing a paid
  // composition tier still goes through the click-to-select detail card
  // below) calls back with whichever data-drop-zone target the tile was
  // released over — WarehousePanel (the actual owner of withdrawItem) decides
  // what to do with it, same routing pattern ForgePanel uses. See dragDrop.tsx.
  onTileDrop?: (overTarget: string, id: string) => void
}

export default function WarehouseGrid({ characterId, onTileDrop }: WarehouseGridProps) {
  const items = useWarehouseStore((state) => state.items)
  const points = useWarehouseStore((state) => state.points)
  const busy = useWarehouseStore((state) => state.busy)
  const fullMessage = useWarehouseStore((state) => state.fullMessage)
  const withdrawItem = useWarehouseStore((state) => state.withdrawItem)
  const clearFullMessage = useWarehouseStore((state) => state.clearFullMessage)
  const templates = useItemTemplatesStore((state) => state.templates)

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [withdrawTier, setWithdrawTier] = useState(0)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  const occupiedCount = items.length
  const emptySlotCount = Math.max(0, WAREHOUSE_SLOT_CAP - occupiedCount)
  const selectedEntry = items.find((entry) => entry.id === selectedEntryId)
  const selectedTemplate = selectedEntry && templates.find((template) => template.id === selectedEntry.template_id)
  const withdrawCost = compositionPointValue(withdrawTier)

  const handleTileDrop = (overTarget: string | null, id: string) => {
    if (overTarget) {
      onTileDrop?.(overTarget, id)
    }
  }

  const selectEntry = (entryId: string) => {
    setWithdrawError(null)
    setWithdrawTier(0)
    setSelectedEntryId((current) => (current === entryId ? null : entryId))
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Warehouse Storage ({occupiedCount}/{WAREHOUSE_SLOT_CAP})
        </p>

        {/* Responsive tracks matching InventoryPanel's own fix (3.5rem below
            `lg`, unchanged 4rem at `lg`+) — the previous fixed 4rem-per-column
            grid was the same overflow bug InventoryPanel had before it was
            fixed, just never caught here since this grid didn't exist yet at
            the time. overflow-x-auto is the same defensive backstop. */}
        <div data-drop-zone="warehouse-storage" className="mt-2 overflow-x-auto">
        <div className="grid grid-cols-[repeat(8,3.5rem)] gap-1.5 lg:grid-cols-[repeat(8,4rem)]">
          {items.map((entry) => {
            const template = templates.find((t) => t.id === entry.template_id)
            const label = template ? template.name : 'Unknown item'
            const tooltip: ItemTooltipData = {
              title: label,
              lines: [`x${entry.count} in Warehouse`, 'Choose a tier to withdraw at'],
            }
            const icon = getItemIcon(template?.slot_type)

            const commonProps = {
              slotId: entry.id,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              icon,
              label,
              tooltip,
              badge: `x${entry.count}`,
              selected: selectedEntryId === entry.id,
            }

            if (onTileDrop) {
              return (
                <DraggableInventorySlot
                  key={entry.id}
                  {...commonProps}
                  dragEnabled
                  dragPayload={{ id: entry.template_id, icon, badge: `x${entry.count}` }}
                  onDrop={handleTileDrop}
                  onClick={() => selectEntry(entry.id)}
                />
              )
            }

            return <InventorySlot key={entry.id} {...commonProps} onClick={() => selectEntry(entry.id)} />
          })}

          {Array.from({ length: emptySlotCount }, (_, index) => (
            <InventorySlot key={`empty-${index}`} slotId={`wh-empty-${index}`} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
          ))}
        </div>
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
              {getItemIcon(selectedTemplate?.slot_type)}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">{selectedTemplate ? selectedTemplate.name : 'Unknown item'}</p>
              <p className="text-xs text-slate-500">x{selectedEntry.count} in Warehouse</p>
            </div>
          </div>

          <div className="mt-3">
            <p className="text-xs text-slate-400">Withdraw at tier:</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setWithdrawTier(0)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                  withdrawTier === 0 ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                Normal (free)
              </button>
              {COMPOSITION_STONE_TIERS.map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setWithdrawTier(tier)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                    withdrawTier === tier
                      ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  +{tier} ({compositionPointValue(tier)} pts)
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={busy || points < withdrawCost}
            onClick={async () => {
              setWithdrawError(null)
              const result = await withdrawItem(characterId, selectedEntry.template_id, withdrawTier)
              if (!result.ok) {
                setWithdrawError(
                  result.error === 'inventory_full'
                    ? 'Inventory is full.'
                    : result.error === 'not_enough_points'
                      ? "You don't have enough Warehouse points."
                      : "Couldn't withdraw that item.",
                )
              }
            }}
            className="mt-3 w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Withdraw{withdrawCost > 0 ? ` (${withdrawCost} pts)` : ''}
          </button>

          {withdrawError && <p className="mt-2 text-xs text-amber-400">{withdrawError}</p>}
        </div>
      )}
    </div>
  )
}
