import EquipmentBar from './EquipmentBar'
import StatsPanel from './StatsPanel'
import InventoryPanel from './InventoryPanel'

// EquipmentBar is always visible up top — a compact equipped-gear summary that
// opens the full Equipment overlay on click. StatsPanel collapses by default (see
// its own expanded state) so the Inventory grid below has room to show without
// scrolling. Inventory also renders inside the Forge overlay (see ForgePanel) so
// its drag-and-drop has the grid right next to the Upgrade Slot — that's an
// additional place it shows up, not a replacement for it being here.
// Zone/Equipment/Market live in the bottom-nav overlay system (see
// BottomNav/OverlayPanel) and have no presence here.
export default function SideHud() {
  return (
    <div className="space-y-4">
      <EquipmentBar />
      <StatsPanel />
      <InventoryPanel />
    </div>
  )
}
