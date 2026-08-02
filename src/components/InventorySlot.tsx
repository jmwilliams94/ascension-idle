import type { DragEvent, PointerEvent } from 'react'
import HoverTooltip from './HoverTooltip'
import ItemTooltip from './ItemTooltip'
import type { ItemTooltipData } from '../game/items/itemTooltip'

// Shared standard tile size — the main Inventory grid, Forge's Upgrade Slot, and
// Forge's Fuel slots all use this so every tile in the game reads as the same
// "unit," rather than three different sizes depending on which panel it's in.
// Responsive (smaller below `lg`, unchanged 4rem at `lg` and up) — a fixed 4rem
// tile size was the root cause of the Inventory grid overflowing narrow phone
// viewports (see CLAUDE.md's PWA & Mobile section); shrinking it here fixes
// every InventoryPanel/Forge/Warehouse usage at once since they all share it.
export const SLOT_SIZE_CLASS = 'h-14 w-14 lg:h-16 lg:w-16'

interface InventorySlotProps {
  // Stable id for this cell (an item's/arrow stack's id for filled slots, a
  // synthetic key for empty ones) — kept as an explicit prop/data attribute, not
  // just a React `key`, so the Forge drag-and-drop step can target a specific slot
  // directly.
  slotId: string
  filled: boolean
  qualityColor?: string
  icon?: string
  // Real art, when supplied, renders instead of the emoji `icon` above (see
  // forgeCosts.ts's METEOR_ICON_SRC for the established pattern of exposing
  // one of these as a shared constant per item).
  iconSrc?: string
  // Plain accessibility label (aria-label). Also used as the native `title` popup,
  // but only when `tooltip` is omitted — otherwise the two would show at once.
  label?: string
  // Universal Diablo/PoE-style hover tooltip content — see ItemTooltip.tsx. Used
  // everywhere a filled tile renders (Inventory grid, Forge's Upgrade/Fuel slots).
  tooltip?: ItemTooltipData
  // Small corner readout, e.g. an arrow stack's "3/50" count — gear doesn't use this.
  badge?: string
  selected?: boolean
  onClick?: () => void
  // Right-click shortcut (e.g. arrow stacks equip directly on right-click instead
  // of requiring select-then-press-Equip) — when provided, the browser's native
  // context menu is suppressed on this tile.
  onContextMenu?: () => void
  // Two coexisting drag systems, picked per call site (never both at once):
  // native HTML5 DnD (still used by Warehouse — see WarehouseGrid/
  // WarehousePanel, unaffected by this step) and Pointer Events (used by Forge
  // — see dragDrop.tsx — which works on touch too, unlike native HTML5 DnD).
  // `draggable` is shared styling (cursor/touch-action) for either system; the
  // native HTML `draggable` attribute itself is only set when onDragStart is
  // provided, so a pointer-only tile never also triggers the browser's own
  // native drag gesture.
  draggable?: boolean
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void
  // True while this specific tile is the one currently being dragged (pointer
  // system only) — dims it so the floating ghost (see dragDrop.tsx) reads as
  // "the thing that moved."
  dragging?: boolean
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerMove?: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerUp?: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerCancel?: (event: PointerEvent<HTMLButtonElement>) => void
  // Overrides the grid's implicit `aspect-square` sizing for standalone (non-grid)
  // contexts like ForgeUpgradeSlot/ForgeMaterialSlot, e.g. "h-20 w-20". Omit when the
  // tile lives inside a grid cell that already constrains its width.
  sizeClassName?: string
  // Optional placeholder text for an empty slot — omitted (renders a plain dimmed
  // box) in the main 40-cell grid, where showing "empty" 40 times would be noisy,
  // but used by standalone drop targets like ForgeUpgradeSlot/ForgeMaterialSlot to
  // hint what goes there.
  emptyHint?: string
}

export default function InventorySlot({
  slotId,
  filled,
  qualityColor,
  icon,
  iconSrc,
  label,
  tooltip,
  badge,
  selected,
  onClick,
  onContextMenu,
  draggable,
  onDragStart,
  onDragEnd,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  sizeClassName = '',
  emptyHint,
}: InventorySlotProps) {
  // Mutually exclusive, not additive — sizeClassName sets its own width/height
  // (e.g. SLOT_SIZE_CLASS), so it must fully replace aspect-square/w-full rather
  // than sit alongside them. Both classes set `width`, and which one wins would
  // otherwise depend on Tailwind's generated stylesheet order, not on where each
  // class appears in this string — not something to rely on.
  const sizingClassName = sizeClassName || 'aspect-square w-full'

  if (!filled) {
    return (
      <div
        data-slot-id={slotId}
        className={`flex items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-950/40 ${sizingClassName}`}
      >
        {emptyHint && <span className="px-1 text-center text-[10px] leading-tight text-slate-600">{emptyHint}</span>}
      </div>
    )
  }

  const button = (
    <button
      type="button"
      data-slot-id={slotId}
      onClick={onClick}
      onContextMenu={
        onContextMenu
          ? (event) => {
              event.preventDefault()
              onContextMenu()
            }
          : undefined
      }
      draggable={draggable && Boolean(onDragStart)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      title={tooltip ? undefined : label}
      aria-label={label}
      className={`relative flex items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg ${sizingClassName} ${
        selected ? 'ring-2 ring-sky-400' : ''
      } ${draggable ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${dragging ? 'opacity-40' : ''}`}
      style={{ borderColor: qualityColor, backgroundColor: qualityColor ? `${qualityColor}22` : undefined }}
    >
      {iconSrc ? <img src={iconSrc} alt="" className="h-3/5 w-3/5 object-contain" /> : icon}
      {badge && <span className="absolute bottom-0.5 right-1 text-[9px] font-semibold text-slate-200">{badge}</span>}
    </button>
  )

  if (!tooltip) {
    return button
  }

  // Portaled to document.body (see HoverTooltip) rather than a plain CSS
  // absolute-positioned overlay — a tile near the edge of a scrollable ancestor
  // (e.g. the Forge overlay's scroll container) would otherwise get its tooltip
  // clipped by that ancestor's overflow, which is exactly what a portal escapes.
  return <HoverTooltip content={<ItemTooltip {...tooltip} />}>{button}</HoverTooltip>
}
