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
// GameShell wraps the active tab's content in a CSS multi-column layout at
// `lg`+ (two equal columns, overflow into column two) — each of the three
// panels here is marked break-inside-avoid so none of them gets visually cut
// in half at a column break, but the panels themselves are deliberately NOT
// wrapped in one shared break-inside-avoid block (unlike most other tabs),
// since they're three genuinely independent cards that can safely land in
// different columns — e.g. EquipmentPanel (tall) filling column one while
// StatsPanel/SkillsPanel flow into column two.
export default function EquipmentTabPage() {
  return (
    <div className="space-y-4">
      <div className="break-inside-avoid">
        <EquipmentPanel />
      </div>
      <div className="break-inside-avoid">
        <StatsPanel />
      </div>
      <div className="break-inside-avoid">
        <SkillsPanel />
      </div>
      <div className="lg:hidden">
        <AscensionCard>
          <InventoryPanel columns={5} equipPopoverEnabled enableCompareToggle />
        </AscensionCard>
      </div>
    </div>
  )
}
