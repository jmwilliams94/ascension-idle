import EquipmentPanel from './EquipmentPanel'
import StatsPanel from './StatsPanel'
import InventoryPanel from './InventoryPanel'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'

// Combines what used to be split across the Equipment overlay (the paper-doll)
// and the always-visible SideHud sidebar (EquipmentBar/Stats) into one page,
// now that there's no persistent sidebar next to a canvas. Stays a single
// column (matching CombatPage's own narrower column, not the two-column
// layout the Forge/Bank tabs use).
//
// EquipmentBar (a compact icon row shown above the paper-doll) was removed —
// redundant with the full paper-doll directly below it, and freeing that space
// let EquipmentPanel's own slot tiles grow larger (see EquipmentPanel).
//
// Inventory added (2026-08-03, confirmed with the user) — its own card below
// the player's Stats card, reusing the same InventoryPanel every other tab
// shares. equipPopoverEnabled (the tap-to-Equip/Compare popover, see
// GearEquipPopover) is on here same as CombatPage's own copies — this page
// is specifically about managing gear, so it's an even more natural fit here
// than on Combat.
export default function EquipmentTabPage() {
  const characterName = useCharacterRecordStore((state) => state.characterName)

  return (
    <div className="mx-auto max-w-md space-y-4">
      <p className="text-lg font-semibold text-white">{characterName}</p>
      <EquipmentPanel />
      <StatsPanel />
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
        <InventoryPanel columns={5} equipPopoverEnabled />
      </div>
    </div>
  )
}
