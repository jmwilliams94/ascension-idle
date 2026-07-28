import StatsPanel from './StatsPanel'
import InventoryPanel from './InventoryPanel'

// Stats and Inventory are both always visible here — neither is a manually-
// selectable tab. Inventory also renders inside the Forge overlay (see
// ForgePanel) so its drag-and-drop has the grid right next to the Upgrade Slot —
// that's an additional place it shows up, not a replacement for it being here.
// Zone/Equipment/Market live in the bottom-nav overlay system (see
// BottomNav/OverlayPanel) and have no presence here.
export default function SideHud() {
  return (
    <div className="space-y-4">
      <StatsPanel />
      <InventoryPanel />
    </div>
  )
}
