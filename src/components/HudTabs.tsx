import EquipmentPanel from './EquipmentPanel'
import ForgePanel from './ForgePanel'
import InventoryPanel from './InventoryPanel'
import MarketplacePanel from './MarketplacePanel'
import StatsPanel from './StatsPanel'
import ZonePanel from './ZonePanel'
import { useHudTabStore, type HudTabId } from '../game/hud/useHudTabStore'

const TABS: { id: HudTabId; label: string }[] = [
  { id: 'stats', label: 'Stats' },
  { id: 'zone', label: 'Zone' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'forge', label: 'Forge' },
  { id: 'marketplace', label: 'Market' },
]

export default function HudTabs() {
  const activeTab = useHudTabStore((state) => state.activeTab)
  const setActiveTab = useHudTabStore((state) => state.setActiveTab)

  return (
    <div>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950/60 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-2 py-1.5 text-xs font-medium ${
              tab.id === activeTab
                ? 'bg-sky-500/10 text-sky-300'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {activeTab === 'stats' && <StatsPanel />}
        {activeTab === 'zone' && <ZonePanel />}
        {activeTab === 'inventory' && <InventoryPanel />}
        {activeTab === 'equipment' && <EquipmentPanel />}
        {activeTab === 'forge' && <ForgePanel />}
        {activeTab === 'marketplace' && <MarketplacePanel />}
      </div>
    </div>
  )
}
