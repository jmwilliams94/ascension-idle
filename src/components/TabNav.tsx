import { useTabStore, type TabId } from '../game/hud/useTabStore'

const TAB_ITEMS: { id: TabId; label: string }[] = [
  { id: 'combat', label: 'Combat' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'forge', label: 'Forge' },
  { id: 'marketplace', label: 'Market' },
  { id: 'shop', label: 'Shop' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'achievements', label: 'Achievements' },
]

export default function TabNav() {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)

  return (
    // 3 columns (2 rows) below `lg`, unchanged single-row 6 columns at `lg`+ —
    // a fixed 6-column grid squeezed every label (worst offenders: "Equipment"/
    // "Warehouse") into a column too narrow to hold it, overflowing into the
    // neighboring tab's column instead of wrapping or shrinking.
    <div className="grid grid-cols-3 gap-2 lg:grid-cols-7">
      {TAB_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setActiveTab(item.id)}
          className={`rounded-xl border px-2 py-2 text-xs font-medium sm:px-3 sm:py-3 sm:text-sm ${
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
