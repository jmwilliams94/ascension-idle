import EquipmentPanel from './EquipmentPanel'
import StatsPanel from './StatsPanel'
import { useProgressionStore } from '../game/stats/useProgressionStore'

// Combines what used to be split across the Equipment overlay (the paper-doll)
// and the always-visible SideHud sidebar (EquipmentBar/Stats) into one page,
// now that there's no persistent sidebar next to a canvas. Inventory itself
// lives on the Combat tab instead (see CombatPage) — this tab doesn't need its
// own copy, so it stays a single column rather than the two-column layout
// tabs that do show Inventory use.
//
// EquipmentBar (a compact icon row shown above the paper-doll) was removed —
// redundant with the full paper-doll directly below it, and freeing that space
// let EquipmentPanel's own slot tiles grow larger (see EquipmentPanel).
export default function EquipmentTabPage() {
  const level = useProgressionStore((state) => state.level)

  return (
    <div className="mx-auto max-w-md space-y-4">
      <p className="text-lg font-semibold text-white">Lv. {level} — Equipment</p>
      <EquipmentPanel />
      <StatsPanel />
    </div>
  )
}
