import EquipmentPanel from './EquipmentPanel'
import StatsPanel from './StatsPanel'
import InventoryPanel from './InventoryPanel'
import { AscensionCard } from './ui/AscensionCard'

// Combines what used to be split across the Equipment overlay (the paper-doll)
// and the always-visible SideHud sidebar (EquipmentBar/Stats) into one page,
// now that there's no persistent sidebar next to a canvas.
//
// EquipmentBar (a compact icon row shown above the paper-doll) was removed —
// redundant with the full paper-doll directly below it, and freeing that space
// let EquipmentPanel's own slot tiles grow larger (see EquipmentPanel).
//
// Inventory added (2026-08-03, confirmed with the user) — its own card,
// reusing the same InventoryPanel every other tab shares. equipPopoverEnabled
// (the tap-to-Equip popover, see GearEquipPopover) is on here same as
// CombatPage's own copies — this page is specifically about managing gear,
// so it's an even more natural fit here than on Combat.
//
// Two-column layout (2026-08-13, requested by the user — supersedes the
// earlier single stacked column): paper-doll + Stats on the left, Inventory
// on the right, same `grid gap-6 lg:grid-cols-2` responsive pattern the
// Forge/Bank/Shop tabs already use (ForgeTwoColumnLayout.tsx), stacking
// vertically below `lg`. No order-1/order-2 reordering needed here (unlike
// Forge's own version of this layout) — Equipment/Stats already precede
// Inventory in the markup, which is also the desired stacked order.
// enableCompareToggle (also 2026-08-13) adds a page-level "Compare" toggle
// above the Inventory grid — while on, hovering a gear tile shows it
// side-by-side against whatever's equipped in the same slot, replacing the
// old per-tile "open the popover, then press Compare" flow (see
// InventoryPanel's own doc comment on that prop). Equipment-tab-only, by
// design — CombatPage's own Inventory copies don't pass this.
export default function EquipmentTabPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <EquipmentPanel />
        <StatsPanel />
      </div>
      <AscensionCard>
        <InventoryPanel columns={5} equipPopoverEnabled enableCompareToggle />
      </AscensionCard>
    </div>
  )
}
