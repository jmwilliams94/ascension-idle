import { useState } from 'react'
import type { DragEvent } from 'react'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { DraggableInventorySlot } from './dragDrop'
import {
  buildGearTooltip,
  formatBaseStats,
  formatItemDisplayName,
  formatQualityAndLevel,
  getItemIcon,
  getQualityColor,
  previewSellPrice,
} from '../game/items/equipmentBonus'
import { EQUIP_SLOTS, useEquipmentStore, type EquipSlot } from '../game/items/useEquipmentStore'
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
  // Present only when rendered inside Forge — makes gear and stone tiles
  // draggable (see dragDrop.tsx), calling back with whichever data-forge-drop
  // target (see ForgeUpgradeSlot/ForgeFuelSlots) the tile was released over, and
  // the dragged id (a real item id, or a synthetic stoneDragId for a stone).
  // Not called if the tile was dropped somewhere with no valid target. Stones
  // don't stack — each tile is exactly one stone, so dragging one tile feeds
  // exactly one; feeding more means dragging in more individual tiles.
  onTileDrop?: (overTarget: string, id: string) => void
  // Present only when rendered inside Warehouse (see WarehousePanel) — makes gear
  // and stone tiles draggable via the older native HTML5 DnD system instead
  // (text/plain dataTransfer, read by WarehouseGrid's own drop zone). Kept as
  // native DnD rather than migrated to Forge's newer Pointer Events system this
  // step — Warehouse's own touch-drag gap is a separate, not-yet-scoped
  // follow-up, not something to fix as a side effect of Forge's fix. Mutually
  // exclusive with onTileDrop — a given InventoryPanel instance uses one system
  // or the other, never both.
  nativeDraggable?: boolean
  // Present only when rendered inside the Shop — adds a "Sell" button to the gear
  // detail card. Every other usage omits this, so gear elsewhere has no sell action.
  // The actual sell logic lives entirely in useInventoryStore.sellItem (removes
  // the item, adds gold) — this is just an opt-in display flag, not a callback.
  enableSelling?: boolean
  // Grid width in columns — defaults to 8 (5 rows) for a wide layout; the Combat
  // page's narrower column passes 5 (8 rows) instead. Always 40 cells total either way.
  columns?: number
}

export default function InventoryPanel({
  reservedItemIds = [],
  onTileDrop,
  nativeDraggable = false,
  enableSelling = false,
  columns = 8,
}: InventoryPanelProps) {
  const items = useInventoryStore((state) => state.items)
  const sellItem = useInventoryStore((state) => state.sellItem)
  const templates = useItemTemplatesStore((state) => state.templates)
  const setEquippedItem = useEquipmentStore((state) => state.setEquippedItem)
  const isEquipped = useEquipmentStore((state) => state.isEquipped)

  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const arrowStacks = useArrowStore((state) => state.stacks)
  const equippedStackId = useArrowStore((state) => state.equippedStackId)
  const setEquippedStackId = useArrowStore((state) => state.setEquippedStackId)
  const stones = useCompositionStore((state) => state.stones)

  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot>(null)
  const [sellBusy, setSellBusy] = useState(false)
  const [sellError, setSellError] = useState<string | null>(null)

  const isHunter = selectedClassId === 'hunter'
  // Empty (fully depleted) stacks stay in the DB so the debounced autosave doesn't
  // need insert/delete diffing (see useArrowStore) — hide them from view here.
  const visibleArrowStacks = isHunter ? arrowStacks.filter((stack) => stack.count > 0) : []

  // The equipped item (if any) no longer shows here at all — once worn, it's
  // shown only in the Equipment tab's paper doll (confirmed, 2026-07-30), and
  // frees its Inventory slot (see occupiedSlotCount in useInventoryStore).
  // Un-equipping brings it straight back since this filter just stops matching.
  const visibleItems = items.filter((item) => !isEquipped(item.id))

  // Stones don't stack — each one is its own tile, not combined into one tile with
  // a count badge. Since there's no acquisition-time cap check for stones yet (no
  // drop mechanic exists — see CLAUDE.md), a manually-set test value could in
  // theory own more stones than fit in the remaining grid; this budget (recomputed
  // from how many tiles have accumulated so far, rather than a mutated counter, to
  // stay a pure reduce) clamps how many tiles actually render so the grid never
  // exceeds its fixed 40 cells, rather than owning stones simply not showing up as
  // a hard error.
  const baseStoneBudget = Math.max(0, INVENTORY_SLOT_CAP - visibleArrowStacks.length - visibleItems.length)
  const stoneTiles = COMPOSITION_STONE_TIERS.reduce<{ tier: number; index: number; dragId: string }[]>((acc, tier) => {
    const owned = stones[String(tier)] ?? 0
    const shown = Math.min(owned, Math.max(0, baseStoneBudget - acc.length))

    for (let index = 0; index < shown; index += 1) {
      acc.push({ tier, index, dragId: stoneDragId(tier, index) })
    }

    return acc
  }, [])

  const occupiedCount = visibleArrowStacks.length + stoneTiles.length + visibleItems.length
  const emptySlotCount = Math.max(0, INVENTORY_SLOT_CAP - occupiedCount)

  const selectedItem =
    selectedSlot?.kind === 'item' && !reservedItemIds.includes(selectedSlot.id)
      ? items.find((item) => item.id === selectedSlot.id)
      : undefined
  const selectedTemplate = selectedItem && templates.find((entry) => entry.id === selectedItem.template_id)
  // All 6 catalog slot_types (weapon/ring/necklace/boots/hat/coat) are
  // functional equip slots now (confirmed, 2026-07-31 — supersedes the
  // earlier "only Main Hand" restriction). This guard stays for safety/
  // forward-compat only — it'd only ever be false for a future slot_type
  // (e.g. a shield) that doesn't have a real paper-doll slot yet.
  const isEquippableSlot = Boolean(selectedTemplate && EQUIP_SLOTS.includes(selectedTemplate.slot_type as EquipSlot))
  const selectedStack =
    selectedSlot?.kind === 'arrow' ? visibleArrowStacks.find((stack) => stack.id === selectedSlot.id) : undefined
  const selectedStoneTier = selectedSlot?.kind === 'stone' ? selectedSlot.tier : undefined

  const slotKey = (slot: NonNullable<SelectedSlot>): string => (slot.kind === 'stone' ? slot.dragId : `${slot.kind}:${slot.id}`)

  // Fixed-size tracks (not grid-cols-N's equal-fraction columns) so tiles stay a
  // consistent size regardless of how wide the surrounding column/page is — matches
  // SLOT_SIZE below, and the same fixed size Forge's Upgrade/Fuel slots use.
  // Tailwind needs each literal spelled out somewhere so its scanner picks it up —
  // a template-literal class name wouldn't be found at build time.
  const gridColsClass = columns === 5 ? 'grid-cols-[repeat(5,4rem)]' : 'grid-cols-[repeat(8,4rem)]'

  const toggleSlot = (slot: NonNullable<SelectedSlot>) => {
    setSelectedSlot((current) => (current && slotKey(current) === slotKey(slot) ? null : slot))
  }

  const handleTileDrop = (overTarget: string | null, id: string) => {
    if (overTarget) {
      onTileDrop?.(overTarget, id)
    }
  }

  // Native HTML5 DnD source for Warehouse (see nativeDraggable above) — sets the
  // same 'text/plain' payload the old Forge system used to, which WarehouseGrid's
  // drop zone already reads.
  const handleNativeDragStart = (id: string) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }

  const handleSell = async (item: ItemInstance) => {
    setSellError(null)
    setSellBusy(true)
    const result = await sellItem(item.id)
    setSellBusy(false)

    if (!result.ok) {
      setSellError("Couldn't sell that item.")
      return
    }

    setSelectedSlot(null)
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
                sizeClassName={SLOT_SIZE_CLASS}
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
              return <InventorySlot key={dragId} slotId={dragId} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const commonProps = {
              slotId: dragId,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              icon: '🔷',
              label: `+${tier} Stone — ${compositionPointValue(tier)} pts`,
              tooltip: buildStoneTooltip(tier),
              selected: selectedSlot?.kind === 'stone' && selectedSlot.dragId === dragId,
            }

            if (onTileDrop) {
              return (
                <DraggableInventorySlot
                  key={dragId}
                  {...commonProps}
                  dragEnabled
                  dragPayload={{ id: dragId, icon: '🔷' }}
                  onDrop={handleTileDrop}
                  onClick={() => toggleSlot({ kind: 'stone', dragId, tier })}
                />
              )
            }

            return (
              <InventorySlot
                key={dragId}
                {...commonProps}
                onClick={() => toggleSlot({ kind: 'stone', dragId, tier })}
                draggable={nativeDraggable}
                onDragStart={nativeDraggable ? handleNativeDragStart(dragId) : undefined}
              />
            )
          })}

          {visibleItems.map((item) => {
            if (reservedItemIds.includes(item.id)) {
              return <InventorySlot key={item.id} slotId={item.id} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            }

            const template = templates.find((entry) => entry.id === item.template_id)
            const label = template ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level) : 'Unknown item'
            const qualityColor = getQualityColor(item.quality_tier)
            const icon = getItemIcon(template?.slot_type)

            const commonProps = {
              slotId: item.id,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              qualityColor,
              icon,
              label,
              tooltip: buildGearTooltip(item, template),
              selected: selectedSlot?.kind === 'item' && selectedSlot.id === item.id,
            }

            if (onTileDrop) {
              return (
                <DraggableInventorySlot
                  key={item.id}
                  {...commonProps}
                  dragEnabled
                  dragPayload={{ id: item.id, icon, qualityColor }}
                  onDrop={handleTileDrop}
                  onClick={() => toggleSlot({ kind: 'item', id: item.id })}
                />
              )
            }

            return (
              <InventorySlot
                key={item.id}
                {...commonProps}
                onClick={() => toggleSlot({ kind: 'item', id: item.id })}
                draggable={nativeDraggable}
                onDragStart={nativeDraggable ? handleNativeDragStart(item.id) : undefined}
              />
            )
          })}

          {Array.from({ length: emptySlotCount }, (_, index) => (
            <InventorySlot key={`empty-${index}`} slotId={`empty-${index}`} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
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
              {getItemIcon(selectedTemplate?.slot_type)}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {selectedTemplate
                  ? formatItemDisplayName(selectedTemplate.name, selectedItem.quality_tier, selectedItem.composition_level)
                  : 'Unknown item'}
              </p>
              <p className="text-xs text-slate-500">{formatQualityAndLevel(selectedItem.quality_tier, selectedItem.level)}</p>
              {selectedTemplate && (
                <p className="text-xs text-slate-500">{formatBaseStats(selectedTemplate.base_stats, selectedItem.quality_tier)}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={isEquipped(selectedItem.id) || !isEquippableSlot}
            title={!isEquippableSlot ? "This slot isn't wearable yet" : undefined}
            onClick={() => selectedTemplate && setEquippedItem(selectedTemplate.slot_type as EquipSlot, selectedItem.id)}
            className={`mt-3 w-full rounded-lg border px-3 py-1.5 text-xs font-medium ${
              isEquipped(selectedItem.id) || !isEquippableSlot
                ? 'cursor-not-allowed border-slate-800 text-slate-600'
                : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
            }`}
          >
            {isEquipped(selectedItem.id) ? 'Equipped' : !isEquippableSlot ? 'Not wearable yet' : 'Equip'}
          </button>

          {enableSelling && (
            <button
              type="button"
              disabled={isEquipped(selectedItem.id) || sellBusy}
              onClick={() => void handleSell(selectedItem)}
              className="mt-2 w-full rounded-lg border border-amber-600 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sellBusy
                ? 'Selling…'
                : `Sell (${previewSellPrice(selectedTemplate?.price ?? 0, selectedItem.quality_tier)} gold)`}
            </button>
          )}
          {sellError && <p className="mt-2 text-xs text-amber-400">{sellError}</p>}
        </div>
      )}
    </div>
  )
}
