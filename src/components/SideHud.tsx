import StatsPanel from './StatsPanel'

// Stats is the only thing shown here — not a manually-selectable tab, just always
// visible. Inventory moved into the Forge overlay itself (see ForgePanel), since
// Forge's drag-and-drop needs the grid rendered inline next to the Upgrade Slot,
// not off in the side panel; Zone/Equipment/Market live in the bottom-nav overlay
// system (see BottomNav/OverlayPanel) and have no presence here either.
export default function SideHud() {
  return (
    <div className="space-y-4">
      <StatsPanel />
    </div>
  )
}
