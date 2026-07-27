import { useState } from 'react'
import StatsPanel from './StatsPanel'
import ZonePanel from './ZonePanel'

type HudTabId = 'stats' | 'zone' | 'inventory' | 'equipment'

const TABS: { id: HudTabId; label: string }[] = [
  { id: 'stats', label: 'Stats' },
  { id: 'zone', label: 'Zone' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'equipment', label: 'Equipment' },
]

// Reserving the Inventory/Equipment tab structure now so the HUD doesn't need
// another restructuring pass once those systems are actually built.
function ComingSoon({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 text-center text-sm text-slate-500">
      {label} — Coming soon
    </div>
  )
}

export default function HudTabs() {
  const [activeTab, setActiveTab] = useState<HudTabId>('stats')

  return (
    <div>
      <div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-950/60 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${
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
        {activeTab === 'inventory' && <ComingSoon label="Inventory" />}
        {activeTab === 'equipment' && <ComingSoon label="Equipment" />}
      </div>
    </div>
  )
}
