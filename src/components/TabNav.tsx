import { useTabStore, type TabId } from '../game/hud/useTabStore'

const TAB_ITEMS: { id: TabId; label: string }[] = [
  { id: 'combat', label: 'Combat' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'lucky', label: 'Lucky' },
  { id: 'forge', label: 'Forge' },
  { id: 'marketplace', label: 'Market' },
  { id: 'shop', label: 'Shop' },
  { id: 'warehouse', label: 'Bank' },
  { id: 'achievements', label: 'Achievements' },
]

export default function TabNav() {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)

  return (
    // Desktop-only (2026-08-02, supersedes the earlier `grid-cols-3` mobile
    // fallback) — mobile now has its own fixed bottom nav bar entirely
    // (MobileBottomNav.tsx, `lg:hidden`), not a shrunk version of this one.
    <div className="hidden grid-cols-8 gap-2 lg:grid">
      {TAB_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setActiveTab(item.id)}
          className={`rounded-xl border px-3 py-3 text-sm font-medium ${
            item.id === activeTab
              ? 'border-sky-500 bg-sky-500/10 text-sky-300'
              : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
