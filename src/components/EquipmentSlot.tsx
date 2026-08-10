import HoverTooltip from './HoverTooltip'
import ItemTooltip from './ItemTooltip'
import type { ItemTooltipData } from '../game/items/itemTooltip'
import { TierEmberEffect } from '../game/items/tierEffects'
import { emberCountForColor, seedFromId } from '../game/items/tierEffectsData'

interface EquipmentSlotProps {
  label: string
  icon?: string
  // Real art, when supplied, renders instead of the emoji `icon` above — same
  // iconSrc-over-icon priority InventorySlot already established (see
  // getGearIconSrc in equipmentBonus.ts).
  iconSrc?: string
  // Non-interactive placeholder for a gear type that doesn't exist yet — shows a
  // faint icon hinting at the slot type, never clickable.
  locked?: boolean
  filled?: boolean
  qualityColor?: string
  // Composition level ("+N") — mirrors InventorySlot's own top-right badge,
  // see its comment for why equipped gear needs its own copy.
  compositionLevel?: number
  // Gear Durability (2026-08-14) — mirrors InventorySlot's own top-left
  // broken badge, same reasoning as compositionLevel above.
  broken?: boolean
  selected?: boolean
  onClick?: () => void
  // Universal Diablo/PoE-style hover tooltip (see ItemTooltip.tsx) — only Weapon
  // ever passes this today, since it's the only functional slot.
  tooltip?: ItemTooltipData
  // Overrides the default h-16 w-16 — EquipmentPanel passes a larger size for
  // its full paper-doll (see SLOT_SIZE there); omit to keep the default.
  sizeClassName?: string
}

// One paper-doll tile. `locked` slots are inert placeholders (Headgear, Boots,
// accessories, extra armor) for gear types that aren't implemented yet — everything
// else (currently just Weapon) is functional: filled/qualityColor reflect the
// equipped item, onClick toggles the detail card in EquipmentPanel.
export default function EquipmentSlot({
  label,
  icon,
  iconSrc,
  locked,
  filled,
  qualityColor,
  compositionLevel,
  broken,
  selected,
  onClick,
  tooltip,
  sizeClassName = 'h-16 w-16',
}: EquipmentSlotProps) {
  // Fixed pixel size rather than aspect-square/w-full — this tile sits inside a
  // grid cell whose column can be much wider than the tile itself (the columns are
  // percentage-based so the paper-doll's positions stay proportional), so sizing
  // off the cell's own width would blow the tile up to match it.
  if (locked) {
    return (
      <div
        title={`${label} (not yet implemented)`}
        className={`flex items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-950/40 text-lg text-slate-700 opacity-50 ${sizeClassName}`}
      >
        {icon}
      </div>
    )
  }

  // Same tier-effect wiring InventorySlot.tsx does — this tile is a separate,
  // bespoke component (not built on InventorySlot, see its own tooltip note
  // above), so it was missed entirely when the effect first went live
  // game-wide, even though every *other* gear tile (Inventory, Forge,
  // Bank) already had it. seedFromId(label) rather than an item id
  // (not available here) — fine since only one tile per slot is ever shown
  // at once, unlike the Inventory grid's many-at-a-time case.
  const emberCount = filled ? emberCountForColor(qualityColor) : 0

  const button = (
    <button
      type="button"
      onClick={onClick}
      title={tooltip ? undefined : label}
      aria-label={label}
      disabled={!onClick}
      className={`relative flex items-center justify-center overflow-hidden rounded-lg border-2 text-lg ${sizeClassName} ${
        filled ? 'bg-slate-800' : 'border-dashed border-slate-700 bg-slate-950/40'
      } ${selected ? 'ring-2 ring-sky-400' : ''} ${!onClick ? 'cursor-default' : ''}`}
      style={filled ? { borderColor: qualityColor, backgroundColor: qualityColor ? `${qualityColor}22` : undefined } : undefined}
    >
      {emberCount > 0 && <TierEmberEffect color={qualityColor as string} count={emberCount} seed={seedFromId(label)} />}
      {iconSrc ? <img src={iconSrc} alt="" className="relative z-10 h-4/5 w-4/5 object-contain" /> : <span className="relative z-10">{icon}</span>}
      {filled && broken && (
        <span className="absolute left-1.5 top-1 z-10 text-[15px] leading-none text-red-500" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>
          🛡
        </span>
      )}
      {filled && Boolean(compositionLevel) && (
        <span
          className="absolute right-1.5 top-1 z-10 text-[18px] font-extrabold leading-none text-slate-100"
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9), 0 -1px 0 rgba(255,255,255,0.35)' }}
        >
          +{compositionLevel}
        </span>
      )}
    </button>
  )

  if (!tooltip) {
    return button
  }

  // Portaled (see HoverTooltip/InventorySlot) so it isn't clipped by the paper-doll
  // grid's own bounds.
  return <HoverTooltip content={<ItemTooltip {...tooltip} />}>{button}</HoverTooltip>
}
