interface InventorySlotProps {
  // Stable id for this cell (an item's id for filled slots, a synthetic key for
  // empty ones) — kept as an explicit prop/data attribute, not just a React `key`,
  // so the upcoming Forge drag-and-drop step can target a specific slot directly.
  slotId: string
  filled: boolean
  qualityColor?: string
  icon?: string
  label?: string
  selected?: boolean
  onClick?: () => void
}

export default function InventorySlot({ slotId, filled, qualityColor, icon, label, selected, onClick }: InventorySlotProps) {
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
      title={label}
      aria-label={label}
      className={`flex aspect-square items-center justify-center rounded-lg border-2 bg-slate-800 text-lg ${
        selected ? 'ring-2 ring-sky-400' : ''
      }`}
      style={{ borderColor: qualityColor, backgroundColor: qualityColor ? `${qualityColor}22` : undefined }}
    >
      {icon}
    </button>
  )
}
