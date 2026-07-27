import { useHudTabStore, type HudTabId } from '../game/hud/useHudTabStore'
import { useShopStore } from '../game/hud/useShopStore'

// A second, more thumb-reachable way to reach a subset of the same World HUD tabs
// HudTabs already controls (shares state via useHudTabStore, doesn't duplicate it) —
// matters for the mobile Remote Control workflow. Stats/Inventory stay side-tab-only.
const BOTTOM_NAV_TABS: { id: HudTabId; label: string }[] = [
  { id: 'zone', label: 'Zone' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'forge', label: 'Forge' },
  { id: 'marketplace', label: 'Market' },
]

export default function BottomNav() {
  const activeTab = useHudTabStore((state) => state.activeTab)
  const setActiveTab = useHudTabStore((state) => state.setActiveTab)
  const openShop = useShopStore((state) => state.open)

  return (
    <div className="mt-4 grid grid-cols-5 gap-2">
      {BOTTOM_NAV_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => setActiveTab(tab.id)}
          className={`rounded-xl border px-3 py-3 text-sm font-medium ${
            tab.id === activeTab
              ? 'border-sky-500 bg-sky-500/10 text-sky-300'
              : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          {tab.label}
        </button>
      ))}

      {/* Shop opens as an overlay on top of the game canvas (see GameShell) rather
          than switching a sidebar tab like the buttons above. */}
      <button
        type="button"
        onClick={openShop}
        className="rounded-xl border border-slate-700 px-3 py-3 text-sm font-medium text-slate-300 hover:border-slate-500"
      >
        Shop
      </button>
    </div>
  )
}
