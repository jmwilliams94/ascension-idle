import StatsPanel from './StatsPanel'
import InventoryPanel from './InventoryPanel'
import { useOverlayStore } from '../game/hud/useOverlayStore'

// Stats is always visible; Inventory only appears automatically while the Forge
// overlay is open (so items are visible ahead of the upcoming drag-and-drop-into-
// Forge step) — neither is a manually-selectable tab. Zone/Equipment/Forge/Market
// moved to the bottom-nav overlay system (see BottomNav/OverlayPanel) and have no
// presence here at all.
export default function SideHud() {
  const activeOverlay = useOverlayStore((state) => state.activeOverlay)

  return (
    <div className="space-y-4">
      <StatsPanel />
      {activeOverlay === 'forge' && <InventoryPanel />}
    </div>
  )
}
