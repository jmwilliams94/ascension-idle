import EquipmentPanel from './EquipmentPanel'
import StatsPanel from './StatsPanel'
import SkillsPanel from './SkillsPanel'
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
// Inventory (2026-08-03, confirmed with the user) used to get its own card
// here, reusing the same InventoryPanel every other tab shares —
// equipPopoverEnabled (the tap-to-Equip popover, see GearEquipPopover) and
// enableCompareToggle (a page-level "Compare" toggle: while on, hovering a
// gear tile shows it side-by-side against whatever's equipped in the same
// slot) were Equipment-tab-only, since this page is specifically about
// managing gear.
//
// Desktop UI overhaul (2026-09-09): that Inventory grid moved out to
// GameShell's persistent right column, which passes both
// equipPopoverEnabled/enableCompareToggle unconditionally now. The
// InventoryPanel below only renders below `lg`, where the persistent grid
// doesn't exist yet.
//
// Two-column layout (2026-09-09, revised same day — a page-wide CSS
// multi-column auto-reflow was tried first and reported by the user as
// producing a worse result than not splitting at all; this is a real,
// hand-built `lg:grid-cols-2` instead, so it's exactly EquipmentPanel in
// column one and Stats+Skills in column two, deterministically, not
// "wherever the browser's reflow algorithm happens to put them"): the
// paper-doll is the one panel worth a full column to itself, so it doesn't
// share; Stats and Skills are shorter and pair naturally in the other
// column. If this page's content changes shape later, don't reach for an
// auto-reflow shortcut again — see GameShell.tsx's own comment on why that
// was reverted.
export default function EquipmentTabPage() {
  return (
    <div className="space-y-4">
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
        <EquipmentPanel />
        <div className="space-y-4">
          <StatsPanel />
          <SkillsPanel />
        </div>
      </div>
      <div className="lg:hidden">
        <AscensionCard>
          <InventoryPanel columns={5} equipPopoverEnabled enableCompareToggle />
        </AscensionCard>
      </div>
    </div>
  )
}
