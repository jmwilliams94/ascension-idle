import type { DragEvent, PointerEvent } from 'react'
import HoverTooltip from './HoverTooltip'
import ItemTooltip from './ItemTooltip'
import type { ItemTooltipData } from '../game/items/itemTooltip'
import { TierEmberEffect } from '../game/items/tierEffects'
import { emberCountForColor, seedFromId } from '../game/items/tierEffectsData'

// Shared standard tile size — the main Inventory grid, Forge's Upgrade Slot, and
// Forge's Fuel slots all use this so every tile in the game reads as the same
// "unit," rather than three different sizes depending on which panel it's in.
// Responsive (smaller below `lg`, unchanged 4rem at `lg` and up) — a fixed 4rem
// tile size was the root cause of the Inventory grid overflowing narrow phone
// viewports (see CLAUDE.md's PWA & Mobile section); shrinking it here fixes
// every InventoryPanel/Forge/Warehouse usage at once since they all share it.
export const SLOT_SIZE_CLASS = 'h-14 w-14 lg:h-16 lg:w-16'

// Width-only companion to SLOT_SIZE_CLASS — for a label-above-square column
// (ForgeUpgradeSlot/ForgeMaterialSlot/ForgePanel's PreviewSquare) that needs
// to stay exactly tile-width even when its own label text ("UPGRADE SLOT")
// is wider than the tile. Without this, a `flex flex-col items-center`
// column sizes itself to its widest child (the label), so a wide label
// silently pushes the whole column wider than its neighbors — throwing off
// both the visual gap between adjacent squares and the true center of the
// row they sit in. Constraining the column to this width forces the label to
// wrap instead.
export const SLOT_WIDTH_CLASS = 'w-14 lg:w-16'

// Fixed height for the label sitting above a Forge column (Upgrade Slot/
// Material/Preview) — "Upgrade Slot" wraps to two lines within
// SLOT_WIDTH_CLASS while "Material"/"Preview" fit on one, so without a
// reserved height the squares below end up at different vertical positions
// (the two-line label pushes its square down further than its neighbors').
// Reserving this much room for every label, then centering the actual text
// inside it, keeps every square's top edge level regardless of how many
// lines its own label wraps to.
export const SLOT_LABEL_HEIGHT_CLASS = 'h-7'

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

  // Confirmed 2026-08-02 (see tierEffects.tsx) — a radiating-ember burst
  // behind any tile whose qualityColor is a "rare" one (gear above Normal
  // quality, or the established rare-material colors). emberCountForColor
  // returns 0 for anything else (Normal, potions, no color at all), and
  // TierEmberEffect itself renders nothing at count 0, so this is safe to
  // compute/render unconditionally rather than needing its own extra guard
  // at every call site.
  const emberCount = emberCountForColor(qualityColor)

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
      className={`relative flex items-center justify-center overflow-hidden rounded-lg border-2 border-slate-700 bg-slate-800 text-lg ${sizingClassName} ${
        selected ? 'ring-2 ring-sky-400' : ''
      } ${draggable ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${dragging ? 'opacity-40' : ''}`}
      style={{ borderColor: qualityColor, backgroundColor: qualityColor ? `${qualityColor}22` : undefined }}
    >
      {emberCount > 0 && <TierEmberEffect color={qualityColor as string} count={emberCount} seed={seedFromId(slotId)} />}
      {iconSrc ? <img src={iconSrc} alt="" className="relative z-10 h-3/5 w-3/5 object-contain" /> : <span className="relative z-10">{icon}</span>}
      {badge && <span className="absolute bottom-0.5 right-1 z-10 text-[9px] font-semibold text-slate-200">{badge}</span>}
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
