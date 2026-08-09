import ItemTooltip from './ItemTooltip'
import type { ItemTooltipData } from '../game/items/itemTooltip'

// Below this viewport width, two 256px tooltip cards plus their gap won't fit
// side by side — stacks vertically instead. Matches GearEquipPopover's own
// former threshold (this component now owns that layout for both call sites).
const SIDE_BY_SIDE_MIN_VIEWPORT = 640

interface CompareTooltipRowProps {
  tooltip: ItemTooltipData
  // Whatever's currently equipped in the same slot, if any — omit/null to
  // render just the single tooltip (no comparison to show).
  compareTooltip?: ItemTooltipData | null
}

// Shared side-by-side layout for a gear tile's own tooltip plus whatever's
// currently equipped in the same slot — used by both InventorySlot's hover/
// long-press peek (Equipment tab's Compare mode, 2026-08-13) and
// GearEquipPopover's click-opened card, so both entry points render
// identically instead of each keeping its own copy of this layout.
export default function CompareTooltipRow({ tooltip, compareTooltip }: CompareTooltipRowProps) {
  if (!compareTooltip) {
    return <ItemTooltip {...tooltip} />
  }

  const sideBySide = typeof window !== 'undefined' && window.innerWidth >= SIDE_BY_SIDE_MIN_VIEWPORT

  return (
    <div className={`flex gap-2 ${sideBySide ? 'flex-row' : 'flex-col'}`}>
      <ItemTooltip {...tooltip} />
      <ItemTooltip {...compareTooltip} />
    </div>
  )
}
