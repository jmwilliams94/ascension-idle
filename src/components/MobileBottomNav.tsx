import { useCombatStore } from '../game/combat/useCombatStore'
import { useTabStore, type TabId } from '../game/hud/useTabStore'

// Fixed bottom nav bar, mobile-only (`lg:hidden` — desktop keeps TabNav.tsx
// unchanged, now `hidden lg:grid`) — confirmed with the user, 2026-08-02, as
// a full replacement for TabNav's own mobile rendering, not a variant of it.
// 7 buttons, one per tab (confirmed: all existing tabs stay a single tap
// away, nothing tucked behind a "More" menu), Combat centered as "Fight"/
// "Idle" — confirmed navigation-only, same as every other button here; it
// does NOT itself start/stop combat (that's still Combat's own Fight/Stop
// button, already built for mobile — see CombatPage.tsx). The label just
// reflects `isFighting` so the bar itself hints at your current state
// without requiring a trip to the Combat page to check.
//
// Grouping either side of center is arbitrary (no design reason to split any
// particular way) — kept in TabNav's own existing left-to-right order, split
// around Combat: Equipment/Forge/Market before it, Shop/Warehouse/
// Achievements after.
const LEFT_ITEMS: { id: TabId; label: string; icon: string }[] = [
  { id: 'equipment', label: 'Equip', icon: '🧍' },
  { id: 'forge', label: 'Forge', icon: '🔥' },
  { id: 'marketplace', label: 'Market', icon: '🤝' },
]

const RIGHT_ITEMS: { id: TabId; label: string; icon: string }[] = [
  { id: 'shop', label: 'Shop', icon: '🛒' },
  { id: 'warehouse', label: 'Wareh.', icon: '📦' },
  { id: 'achievements', label: 'Achiev.', icon: '🏆' },
]

function NavButton({ id, label, icon }: { id: TabId; label: string; icon: string }) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === id

  return (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium leading-tight ${
        active ? 'text-sky-300' : 'text-slate-400'
      }`}
    >
      <span className="text-lg">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

function FightNavButton() {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const isFighting = useCombatStore((state) => state.isFighting)
  const active = activeTab === 'combat'

  return (
    <button
      type="button"
      onClick={() => setActiveTab('combat')}
      className="flex flex-1 flex-col items-center justify-center gap-0.5"
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full border-2 text-lg shadow-lg ${
          isFighting
            ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 shadow-emerald-500/20'
            : active
              ? 'border-sky-400 bg-sky-500/20 text-sky-300 shadow-sky-500/20'
              : 'border-slate-600 bg-slate-800 text-slate-300 shadow-black/30'
        }`}
      >
        ⚔️
      </span>
      <span className={`text-[10px] font-semibold leading-tight ${isFighting ? 'text-emerald-300' : 'text-slate-400'}`}>
        {isFighting ? 'Fighting' : 'Idle'}
      </span>
    </button>
  )
}

export default function MobileBottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800/80 bg-slate-950/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-md items-stretch px-1">
        {LEFT_ITEMS.map((item) => (
          <NavButton key={item.id} {...item} />
        ))}
        <FightNavButton />
        {RIGHT_ITEMS.map((item) => (
          <NavButton key={item.id} {...item} />
        ))}
      </div>
    </nav>
  )
}
