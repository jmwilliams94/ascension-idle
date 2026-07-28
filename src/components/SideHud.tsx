import StatsPanel from './StatsPanel'
import InventoryPanel from './InventoryPanel'

// Stats and Inventory are both always visible here — neither is a manually-
// selectable tab. Zone/Equipment/Forge/Market moved to the bottom-nav overlay
// system (see BottomNav/OverlayPanel) and have no presence here at all.
export default function SideHud() {
  return (
    <div className="space-y-4">
      <StatsPanel />
      <InventoryPanel />
    </div>
  )
}
