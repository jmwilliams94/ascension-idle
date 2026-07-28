import HoverTooltip from './HoverTooltip'
import ItemTooltip from './ItemTooltip'
import type { ItemTooltipData } from '../game/items/itemTooltip'

interface EquipmentSlotProps {
  label: string
  icon?: string
  // Non-interactive placeholder for a gear type that doesn't exist yet — shows a
  // faint icon hinting at the slot type, never clickable.
  locked?: boolean
  filled?: boolean
  qualityColor?: string
  selected?: boolean
  onClick?: () => void
  // Universal Diablo/PoE-style hover tooltip (see ItemTooltip.tsx) — only Weapon
  // ever passes this today, since it's the only functional slot.
  tooltip?: ItemTooltipData
}

// One paper-doll tile. `locked` slots are inert placeholders (Headgear, Boots,
// accessories, extra armor) for gear types that aren't implemented yet — everything
// else (currently just Weapon) is functional: filled/qualityColor reflect the
// equipped item, onClick toggles the detail card in EquipmentPanel.
export default function EquipmentSlot({ label, icon, locked, filled, qualityColor, selected, onClick, tooltip }: EquipmentSlotProps) {
  // Fixed pixel size rather than aspect-square/w-full — this tile sits inside a
  // grid cell whose column can be much wider than the tile itself (the columns are
  // percentage-based so the paper-doll's positions stay proportional), so sizing
  // off the cell's own width would blow the tile up to match it.
  if (locked) {
    return (
      <div
        title={`${label} (not yet implemented)`}
        className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-950/40 text-lg text-slate-700 opacity-50"
      >
        {icon}
      </div>
    )
  }

  const button = (
    <button
      type="button"
      onClick={onClick}
      title={tooltip ? undefined : label}
      aria-label={label}
      disabled={!onClick}
      className={`flex h-16 w-16 items-center justify-center rounded-lg border-2 text-lg ${
        filled ? 'bg-slate-800' : 'border-dashed border-slate-700 bg-slate-950/40'
      } ${selected ? 'ring-2 ring-sky-400' : ''} ${!onClick ? 'cursor-default' : ''}`}
      style={filled ? { borderColor: qualityColor, backgroundColor: qualityColor ? `${qualityColor}22` : undefined } : undefined}
    >
      {icon}
    </button>
  )

  if (!tooltip) {
    return button
  }

  // Portaled (see HoverTooltip/InventorySlot) so it isn't clipped by the paper-doll
  // grid's own bounds.
  return <HoverTooltip content={<ItemTooltip {...tooltip} />}>{button}</HoverTooltip>
}
