import type { DragEvent } from 'react'

interface InventorySlotProps {
  // Stable id for this cell (an item's/arrow stack's id for filled slots, a
  // synthetic key for empty ones) — kept as an explicit prop/data attribute, not
  // just a React `key`, so the Forge drag-and-drop step can target a specific slot
  // directly.
  slotId: string
  filled: boolean
  qualityColor?: string
  icon?: string
  label?: string
  // Small corner readout, e.g. an arrow stack's "3/50" count — gear doesn't use this.
  badge?: string
  selected?: boolean
  onClick?: () => void
  // Native HTML5 drag-and-drop (see ForgePanel) — omit both to leave the tile
  // non-draggable, same as before this existed.
  draggable?: boolean
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void
}

export default function InventorySlot({
  slotId,
  filled,
  qualityColor,
  icon,
  label,
  badge,
  selected,
  onClick,
  draggable,
  onDragStart,
  onDragEnd,
}: InventorySlotProps) {
  if (!filled) {
    return (
      <div
        data-slot-id={slotId}
        className="aspect-square rounded-lg border border-dashed border-slate-800 bg-slate-950/40"
      />
    )
  }

  return (
    <button
      type="button"
      data-slot-id={slotId}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={label}
      aria-label={label}
      className={`relative flex aspect-square items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg ${
        selected ? 'ring-2 ring-sky-400' : ''
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ borderColor: qualityColor, backgroundColor: qualityColor ? `${qualityColor}22` : undefined }}
    >
      {icon}
      {badge && <span className="absolute bottom-0.5 right-1 text-[9px] font-semibold text-slate-200">{badge}</span>}
    </button>
  )
}
