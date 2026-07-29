import EquipmentBar from './EquipmentBar'
import EquipmentPanel from './EquipmentPanel'
import StatsPanel from './StatsPanel'
import InventoryPanel from './InventoryPanel'
import { useProgressionStore } from '../game/stats/useProgressionStore'

// Combines what used to be split across the Equipment overlay (the paper-doll)
// and the always-visible SideHud sidebar (EquipmentBar/Stats/Inventory) into one
// page, now that there's no persistent sidebar next to a canvas — Inventory is
// only visible while on this tab (see the pivot plan's sidebar-layout decision).
export default function EquipmentTabPage() {
  const level = useProgressionStore((state) => state.level)

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold text-white">Lv. {level} — Equipment</p>
      <EquipmentBar />
      <EquipmentPanel />
      <StatsPanel />
      <InventoryPanel />
    </div>
  )
}
