import { useState } from 'react'
import type { DragEvent } from 'react'
import InventorySlot from './InventorySlot'
import { buildGearTooltip, formatBaseStats, formatItemDisplayName, formatQualityAndLevel, getQualityColor } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { COMPOSITION_STONE_TIERS, buildStoneTooltip, compositionPointValue, stoneDragId } from '../game/items/forgeCosts'
import type { ItemTooltipData } from '../game/items/itemTooltip'
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
type SelectedSlot = { kind: 'item'; id: string } | { kind: 'arrow'; id: string } | { kind: 'stone'; dragId: string; tier: number } | null

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
  // back with the tier being dragged. Stones don't stack — each tile is exactly one
  // stone, so dragging one tile feeds exactly one; feeding more means dragging in
  // more individual tiles.
  onStoneDragStart?: (tier: number) => void
  // Grid width in columns — defaults to 8 (5 rows) for a wide layout; the Combat
  // page's narrower column passes 5 (8 rows) instead. Always 40 cells total either way.
  columns?: number
}

export default function InventoryPanel({
  reservedItemIds = [],
  onItemDragStart,
  onStoneDragStart,
  columns = 8,
}: InventoryPanelProps) {
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

  // Stones don't stack — each one is its own tile, not combined into one tile with
  // a count badge. Since there's no acquisition-time cap check for stones yet (no
  // drop mechanic exists — see CLAUDE.md), a manually-set test value could in
  // theory own more stones than fit in the remaining grid; this budget (recomputed
  // from how many tiles have accumulated so far, rather than a mutated counter, to
  // stay a pure reduce) clamps how many tiles actually render so the grid never
  // exceeds its fixed 40 cells, rather than owning stones simply not showing up as
  // a hard error.
  const baseStoneBudget = Math.max(0, INVENTORY_SLOT_CAP - visibleArrowStacks.length - items.length)
  const stoneTiles = COMPOSITION_STONE_TIERS.reduce<{ tier: number; index: number; dragId: string }[]>((acc, tier) => {
    const owned = stones[String(tier)] ?? 0
    const shown = Math.min(owned, Math.max(0, baseStoneBudget - acc.length))

    for (let index = 0; index < shown; index += 1) {
      acc.push({ tier, index, dragId: stoneDragId(tier, index) })
    }

    return acc
  }, [])

  const occupiedCount = visibleArrowStacks.length + stoneTiles.length + items.length
  const emptySlotCount = Math.max(0, INVENTORY_SLOT_CAP - occupiedCount)

  const selectedItem =
    selectedSlot?.kind === 'item' && !reservedItemIds.includes(selectedSlot.id)
      ? items.find((item) => item.id === selectedSlot.id)
      : undefined
  const selectedTemplate = selectedItem && templates.find((entry) => entry.id === selectedItem.template_id)
  const selectedStack =
    selectedSlot?.kind === 'arrow' ? visibleArrowStacks.find((stack) => stack.id === selectedSlot.id) : undefined
  const selectedStoneTier = selectedSlot?.kind === 'stone' ? selectedSlot.tier : undefined

  const slotKey = (slot: NonNullable<SelectedSlot>): string => (slot.kind === 'stone' ? slot.dragId : `${slot.kind}:${slot.id}`)

  // Tailwind needs each column-count class spelled out literally somewhere so its
  // scanner picks it up — a template-literal class name wouldn't be found at build time.
  const gridColsClass = columns === 5 ? 'grid-cols-5' : 'grid-cols-8'

  const toggleSlot = (slot: NonNullable<SelectedSlot>) => {
    setSelectedSlot((current) => (current && slotKey(current) === slotKey(slot) ? null : slot))
  }

  const handleDragStart = (item: ItemInstance) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
    onItemDragStart?.(item)
  }

  const handleStoneDragStart = (dragId: string, tier: number) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', dragId)
    onStoneDragStart?.(tier)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Items ({occupiedCount}/{INVENTORY_SLOT_CAP})
        </p>

        <div className={`mt-2 grid ${gridColsClass} gap-1.5`}>
          {visibleArrowStacks.map((stack) => {
            const type = ARROW_TYPES[stack.arrowType]
            const arrowTooltip: ItemTooltipData = {
              title: type.displayName,
              lines: ['Ammo', `${stack.count} / ${type.stackSize}`],
              stats: [type.description, 'Right-click to equip'],
            }

            return (
              <InventorySlot
                key={stack.id}
                slotId={stack.id}
                filled
                icon="🏹"
                label={`${type.displayName} (${stack.count}/${type.stackSize})`}
                tooltip={arrowTooltip}
                badge={`${stack.count}/${type.stackSize}`}
                selected={selectedSlot?.kind === 'arrow' && selectedSlot.id === stack.id}
                onClick={() => toggleSlot({ kind: 'arrow', id: stack.id })}
                onContextMenu={() => setEquippedStackId(stack.id)}
              />
            )
          })}

          {stoneTiles.map(({ tier, dragId }) => {
            if (reservedItemIds.includes(dragId)) {
              return <InventorySlot key={dragId} slotId={dragId} filled={false} />
            }

            return (
              <InventorySlot
                key={dragId}
                slotId={dragId}
                filled
                icon="🔷"
                label={`+${tier} Stone — ${compositionPointValue(tier)} pts`}
                tooltip={buildStoneTooltip(tier)}
                selected={selectedSlot?.kind === 'stone' && selectedSlot.dragId === dragId}
                onClick={() => toggleSlot({ kind: 'stone', dragId, tier })}
                draggable={Boolean(onStoneDragStart)}
                onDragStart={onStoneDragStart ? handleStoneDragStart(dragId, tier) : undefined}
              />
            )
          })}

          {items.map((item) => {
            if (reservedItemIds.includes(item.id)) {
              return <InventorySlot key={item.id} slotId={item.id} filled={false} />
            }

            const template = templates.find((entry) => entry.id === item.template_id)
            const label = template ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level) : 'Unknown item'

            return (
              <InventorySlot
                key={item.id}
                slotId={item.id}
                filled
                qualityColor={getQualityColor(item.quality_tier)}
                icon="🗡️"
                label={label}
                tooltip={buildGearTooltip(item, template)}
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
                {compositionPointValue(selectedStoneTier)} pts · {stones[String(selectedStoneTier)] ?? 0} owned total
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
                {selectedTemplate
                  ? formatItemDisplayName(selectedTemplate.name, selectedItem.quality_tier, selectedItem.composition_level)
                  : 'Unknown item'}
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
