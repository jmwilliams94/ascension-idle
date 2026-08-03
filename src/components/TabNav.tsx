import { useCombatStore } from '../game/combat/useCombatStore'
import { useTabStore, type TabId } from '../game/hud/useTabStore'
import { TAB_ICONS, useEquippedWeaponIcon } from '../game/hud/navIcons'
import NavIconGlyph from './NavIconGlyph'

const TAB_ITEMS: { id: TabId; label: string }[] = [
  { id: 'combat', label: 'Combat' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'lucky', label: 'LuckyLad' },
  { id: 'forge', label: 'Forge' },
  { id: 'marketplace', label: 'Market' },
  { id: 'shop', label: 'Shop' },
  { id: 'bank', label: 'Bank' },
  { id: 'achievements', label: 'Achievements' },
]

const TAB_BUTTON_CLASS =
  'flex flex-col items-center justify-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-medium transition-colors'

// Combat's own button (2026-08-03) — desktopified version of MobileBottomNav's
// FightNavButton: same dynamic equipped-weapon icon and live Fighting/Idle
// state/color, just sized up and given the same bordered-box chrome every
// other desktop tab button already uses (rather than mobile's borderless
// bottom-bar chrome), so it still lines up cleanly inside the flat 8-column
// grid alongside the rest.
function CombatTabButton() {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const isFighting = useCombatStore((state) => state.isFighting)
  const active = activeTab === 'combat'
  const weaponIcon = useEquippedWeaponIcon()

  return (
    <button
      type="button"
      onClick={() => setActiveTab('combat')}
      className={`${TAB_BUTTON_CLASS} ${active ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-base shadow-lg ${
          isFighting
            ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 shadow-emerald-500/20'
            : active
              ? 'border-sky-400 bg-sky-500/20 text-sky-300 shadow-sky-500/20'
              : 'border-slate-600 bg-slate-800 text-slate-300 shadow-black/30'
        }`}
      >
        {weaponIcon}
      </span>
      <span className={isFighting ? 'text-emerald-300' : undefined}>{isFighting ? 'Fighting' : 'Idle'}</span>
    </button>
  )
}

function TabButton({ id, label }: { id: TabId; label: string }) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === id
  const icon = TAB_ICONS[id]

  return (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`${TAB_BUTTON_CLASS} ${active ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
    >
      {icon && <NavIconGlyph icon={icon} sizeClassName="h-8 w-8" />}
      <span>{label}</span>
    </button>
  )
}

// Desktop-only (`hidden lg:grid` — mobile has its own fixed bottom nav bar
// entirely, MobileBottomNav.tsx). Desktopified version of that bar (2026-08-03,
// confirmed with the user): same icon art / dynamic Combat weapon-icon
// treatment, but all 8 tabs shown flat rather than mobile's Town rollup
// grouping — desktop has the horizontal room mobile doesn't, so the
// space-saving rollup isn't needed here.
export default function TabNav() {
  return (
    <div className="hidden grid-cols-8 gap-2 lg:grid">
      <CombatTabButton />
      {TAB_ITEMS.filter((item) => item.id !== 'combat').map((item) => (
        <TabButton key={item.id} id={item.id} label={item.label} />
      ))}
    </div>
  )
}
