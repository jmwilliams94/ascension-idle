import { useState } from 'react'
import type { DragEvent } from 'react'
import InventorySlot from './InventorySlot'
import { formatBaseStats, formatItemDisplayName, formatQualityAndLevel, getQualityColor } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { COMPOSITION_STONE_TIERS, compositionPointValue, stoneDragId } from '../game/items/forgeCosts'
import { useCompositionStore } from '../game/items/useCompositionStore'
import { INVENTORY_SLOT_CAP, useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { ARROW_TYPES } from '../game/items/arrowTypes'

// A single fixed 40-cell grid shared by gear (item_instances), Hunter arrow
// stacks, and Composition stones — a stack/stone tier takes up a slot exactly
// like a gear item does, all counting against the same cap (see
// occupiedSlotCount in useInventoryStore). Always renders all 40 cells, empty
// ones dimmed/unclickable, so Forge's drag-and-drop has a stable, always-present
// set of slots to pick gear/stones up from.
type SelectedSlot = { kind: 'item'; id: string } | { kind: 'arrow'; id: string } | { kind: 'stone'; tier: number } | null

interface InventoryPanelProps {
  // Gear items/stone tiers currently sitting in Forge's Upgrade Slot and/or Fuel
  // zone (if any) — their cells render empty here instead of filled, so nothing is
  // ever shown in two Forge drop targets (or the grid and a drop target) at once.
  // Stone tiers use the synthetic id from stoneDragId, real items use their own id.
  // Only ForgePanel passes this; every other usage is unaffected.
  reservedItemIds?: string[]
  // Present only when rendered inside Forge — makes gear tiles draggable, calling
  // back with the item being dragged.
  onItemDragStart?: (item: ItemInstance) => void
  // Present only when rendered inside Forge — makes stone tiles draggable, calling
  // back with the tier being dragged. Dragging a stone tile always represents its
  // entire current count for that tier (there's no per-stack id to split, only a
  // running total per tier), same all-or-nothing behavior as a real fuel item.
  onStoneDragStart?: (tier: number) => void
}

export default function InventoryPanel({ reservedItemIds = [], onItemDragStart, onStoneDragStart }: InventoryPanelProps) {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const equippedItemId = useEquipmentStore((state) => state.equippedItemId)
  const setEquippedItemId = useEquipmentStore((state) => state.setEquippedItemId)

  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const arrowStacks = useArrowStore((state) => state.stacks)
  const equippedStackId = useArrowStore((state) => state.equippedStackId)
  const setEquippedStackId = useArrowStore((state) => state.setEquippedStackId)
  const stones = useCompositionStore((state) => state.stones)

  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot>(null)

  const isHunter = selectedClassId === 'hunter'
  // Empty (fully depleted) stacks stay in the DB so the debounced autosave doesn't
  // need insert/delete diffing (see useArrowStore) — hide them from view here.
  const visibleArrowStacks = isHunter ? arrowStacks.filter((stack) => stack.count > 0) : []
  // Only tiers the player actually owns get a tile — same "hide the empty ones"
  // treatment as depleted arrow stacks.
  const presentStoneTiers = COMPOSITION_STONE_TIERS.filter((tier) => (stones[String(tier)] ?? 0) > 0)

  const occupiedCount = visibleArrowStacks.length + presentStoneTiers.length + items.length
  const emptySlotCount = Math.max(0, INVENTORY_SLOT_CAP - occupiedCount)

  const selectedItem =
    selectedSlot?.kind === 'item' && !reservedItemIds.includes(selectedSlot.id)
      ? items.find((item) => item.id === selectedSlot.id)
      : undefined
  const selectedTemplate = selectedItem && templates.find((entry) => entry.id === selectedItem.template_id)
  const selectedStack =
    selectedSlot?.kind === 'arrow' ? visibleArrowStacks.find((stack) => stack.id === selectedSlot.id) : undefined
  const selectedStoneTier = selectedSlot?.kind === 'stone' ? selectedSlot.tier : undefined

  const slotKey = (slot: NonNullable<SelectedSlot>): string => (slot.kind === 'stone' ? `stone:${slot.tier}` : `${slot.kind}:${slot.id}`)

  const toggleSlot = (slot: NonNullable<SelectedSlot>) => {
    setSelectedSlot((current) => (current && slotKey(current) === slotKey(slot) ? null : slot))
  }

  const handleDragStart = (item: ItemInstance) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
    onItemDragStart?.(item)
  }

  const handleStoneDragStart = (tier: number) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', stoneDragId(tier))
    onStoneDragStart?.(tier)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Items ({occupiedCount}/{INVENTORY_SLOT_CAP})
        </p>

        <div className="mt-2 grid grid-cols-8 gap-1.5">
          {visibleArrowStacks.map((stack) => {
            const type = ARROW_TYPES[stack.arrowType]

            return (
              <InventorySlot
                key={stack.id}
                slotId={stack.id}
                filled
                icon="🏹"
                label={`${type.displayName} (${stack.count}/${type.stackSize})`}
                badge={`${stack.count}/${type.stackSize}`}
                selected={selectedSlot?.kind === 'arrow' && selectedSlot.id === stack.id}
                onClick={() => toggleSlot({ kind: 'arrow', id: stack.id })}
              />
            )
          })}

          {presentStoneTiers.map((tier) => {
            const dragId = stoneDragId(tier)
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} />
            }

            const count = stones[String(tier)] ?? 0

            return (
              <InventorySlot
                key={dragId}
                slotId={dragId}
                filled
                icon="🔷"
                label={`+${tier} Stone (${count}) — ${compositionPointValue(tier)} pts each`}
                badge={`${count}`}
                selected={selectedStoneTier === tier}
                onClick={() => toggleSlot({ kind: 'stone', tier })}
                draggable={Boolean(onStoneDragStart)}
                onDragStart={onStoneDragStart ? handleStoneDragStart(tier) : undefined}
              />
            )
          })}

          {items.map((item) => {
            if (reservedItemIds.includes(item.id)) {
              return <InventorySlot key={item.id} slotId={item.id} filled={false} />
            }

            const template = templates.find((entry) => entry.id === item.template_id)
            const label = template ? formatItemDisplayName(template.name, item.quality_tier) : 'Unknown item'

            return (
              <InventorySlot
                key={item.id}
                slotId={item.id}
                filled
                qualityColor={getQualityColor(item.quality_tier)}
                icon="🗡️"
                label={label}
                selected={selectedSlot?.kind === 'item' && selectedSlot.id === item.id}
                onClick={() => toggleSlot({ kind: 'item', id: item.id })}
                draggable={Boolean(onItemDragStart)}
                onDragStart={onItemDragStart ? handleDragStart(item) : undefined}
              />
            )
          })}

          {Array.from({ length: emptySlotCount }, (_, index) => (
            <InventorySlot key={`empty-${index}`} slotId={`empty-${index}`} filled={false} />
          ))}
        </div>
      </div>

      {selectedStack && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg">
              🏹
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">{ARROW_TYPES[selectedStack.arrowType].displayName}</p>
              <p className="text-xs text-slate-500">
                {selectedStack.count} / {ARROW_TYPES[selectedStack.arrowType].stackSize}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={selectedStack.id === equippedStackId}
            onClick={() => setEquippedStackId(selectedStack.id)}
            className={`mt-3 w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
              selectedStack.id === equippedStackId
                ? 'cursor-not-allowed border-slate-800 text-slate-600'
                : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
            }`}
          >
            {selectedStack.id === equippedStackId ? 'Equipped' : 'Equip'}
          </button>
        </div>
      )}

      {selectedStoneTier !== undefined && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg">
              🔷
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">+{selectedStoneTier} Stone</p>
              <p className="text-xs text-slate-500">
                Owned: {stones[String(selectedStoneTier)] ?? 0} · {compositionPointValue(selectedStoneTier)} pts each
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedItem && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-lg"
              style={{ borderColor: getQualityColor(selectedItem.quality_tier) }}
            >
              🗡️
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {selectedTemplate ? formatItemDisplayName(selectedTemplate.name, selectedItem.quality_tier) : 'Unknown item'}
              </p>
              <p className="text-xs text-slate-500">{formatQualityAndLevel(selectedItem.quality_tier, selectedItem.level)}</p>
              {selectedTemplate && <p className="text-xs text-slate-500">{formatBaseStats(selectedTemplate.base_stats)}</p>}
            </div>
          </div>

          <button
            type="button"
            disabled={selectedItem.id === equippedItemId}
            onClick={() => setEquippedItemId(selectedItem.id)}
            className={`mt-3 w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
              selectedItem.id === equippedItemId
                ? 'cursor-not-allowed border-slate-800 text-slate-600'
                : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
            }`}
          >
            {selectedItem.id === equippedItemId ? 'Equipped' : 'Equip'}
          </button>
        </div>
      )}
    </div>
  )
}
