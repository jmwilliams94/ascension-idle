import type { DragEvent } from 'react'
import HoverTooltip from './HoverTooltip'
import ItemTooltip from './ItemTooltip'
import type { ItemTooltipData } from '../game/items/itemTooltip'

// Shared standard tile size — the main Inventory grid, Forge's Upgrade Slot, and
// Forge's Fuel slots all use this so every tile in the game reads as the same
// "unit," rather than three different sizes depending on which panel it's in.
export const SLOT_SIZE_CLASS = 'h-16 w-16'

interface InventorySlotProps {
  // Stable id for this cell (an item's/arrow stack's id for filled slots, a
  // synthetic key for empty ones) — kept as an explicit prop/data attribute, not
  // just a React `key`, so the Forge drag-and-drop step can target a specific slot
  // directly.
  slotId: string
  filled: boolean
  qualityColor?: string
  icon?: string
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
  // Native HTML5 drag-and-drop (see ForgePanel) — omit both to leave the tile
  // non-draggable, same as before this existed.
  draggable?: boolean
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void
  // Overrides the grid's implicit `aspect-square` sizing for standalone (non-grid)
  // contexts like ForgeUpgradeSlot/ForgeFuelSlots, e.g. "h-20 w-20". Omit when the
  // tile lives inside a grid cell that already constrains its width.
  sizeClassName?: string
  // Optional placeholder text for an empty slot — omitted (renders a plain dimmed
  // box) in the main 40-cell grid, where showing "empty" 40 times would be noisy,
  // but used by standalone drop targets like ForgeUpgradeSlot/ForgeFuelSlots to
  // hint what goes there.
  emptyHint?: string
}

export default function InventorySlot({
  slotId,
  filled,
  qualityColor,
  icon,
  label,
  tooltip,
  badge,
  selected,
  onClick,
  onContextMenu,
  draggable,
  onDragStart,
  onDragEnd,
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
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={tooltip ? undefined : label}
      aria-label={label}
      className={`relative flex items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg ${sizingClassName} ${
        selected ? 'ring-2 ring-sky-400' : ''
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ borderColor: qualityColor, backgroundColor: qualityColor ? `${qualityColor}22` : undefined }}
    >
      {icon}
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
