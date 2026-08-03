import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCombatStore } from '../game/combat/useCombatStore'
import { useTabStore, type TabId } from '../game/hud/useTabStore'
import { TAB_ICONS, useEquippedWeaponIcon } from '../game/hud/navIcons'
import NavIconGlyph from './NavIconGlyph'

// Fixed bottom nav bar, mobile-only (`lg:hidden` — desktop keeps TabNav.tsx
// unchanged, now `hidden lg:grid`). Combat is centered as "Fight"/"Idle" —
// confirmed navigation-only, same as every other button here; it does NOT
// itself start/stop combat (that's still Combat's own Fight/Stop button,
// already built for mobile — see CombatPage.tsx). The label just reflects
// `isFighting` so the bar itself hints at your current state without
// requiring a trip to the Combat page to check.
//
// Restructured (2026-08-03, confirmed with the user) — supersedes the
// original flat 7-button layout (Equipment/Forge/Market | Fight | Shop/Bank/
// Achievements). Now 5 always-visible slots — Equip, Lucky (new tab, see
// LuckyPanel), Fighting, Town, Achieve — with Market/Bank/Shop/Forge moved
// off the bar entirely into a "Town" rollup (TownNavButton below) rather
// than each getting its own permanent slot. Desktop's TabNav.tsx is
// unaffected by this — it just shows all 8 tabs flat (room isn't scarce
// there the way it is on a phone-width bottom bar), Town is a mobile-only
// grouping concept, not a real tab of its own.
const LEFT_ITEMS: { id: TabId; label: string }[] = [
  { id: 'equipment', label: 'Equip' },
  // Renamed "Lucky" -> "LuckyLad" (2026-08-03, confirmed with the user,
  // wording + mascot art only) — real art now exists (public/lucky-icons/
  // luckylad.png), replacing the placeholder 🍀 emoji.
  { id: 'lucky', label: 'LuckyLad' },
]

// TownNavButton's own rollup contents — everything that used to have its own
// permanent bottom-nav slot except Equipment/Achievements (which stayed put)
// and Combat (always centered). No art exists for Market yet, same
// established "mixed icon language until more art arrives" precedent as
// before this restructure.
const TOWN_ITEMS: { id: TabId; label: string }[] = [
  { id: 'marketplace', label: 'Market' },
  { id: 'warehouse', label: 'Bank' },
  { id: 'shop', label: 'Shop' },
  { id: 'forge', label: 'Forge' },
]

const RIGHT_ITEMS: { id: TabId; label: string }[] = [{ id: 'achievements', label: 'Achiev.' }]

function NavButton({ id, label }: { id: TabId; label: string }) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === id
  const icon = TAB_ICONS[id]

  return (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium leading-tight ${
        active ? 'text-sky-300' : 'text-slate-400'
      }`}
    >
      {icon && <NavIconGlyph icon={icon} />}
      <span className="truncate">{label}</span>
    </button>
  )
}

function FightNavButton() {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const isFighting = useCombatStore((state) => state.isFighting)
  const active = activeTab === 'combat'
  const weaponIcon = useEquippedWeaponIcon()

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
        {weaponIcon}
      </span>
      <span className={`text-[10px] font-semibold leading-tight ${isFighting ? 'text-emerald-300' : 'text-slate-400'}`}>
        {isFighting ? 'Fighting' : 'Idle'}
      </span>
    </button>
  )
}

// Speed-dial style: tapping Town toggles a small stack of buttons rising up
// from directly above it (Market/Bank/Shop/Forge, see TOWN_ITEMS) rather than
// navigating anywhere itself — "rolls the buttons upward," per the user's own
// framing. Picking one of the rolled-out items navigates and collapses the
// stack in one motion; tapping Town again while open collapses it without
// navigating; tapping anywhere else on the page also collapses it (the same
// outside-pointerdown-dismiss pattern GearEquipPopover already established in
// this codebase), so it doesn't linger open over an unrelated tab.
function TownNavButton() {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const [expanded, setExpanded] = useState(false)
  const active = TOWN_ITEMS.some((item) => item.id === activeTab)

  useEffect(() => {
    if (!expanded) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-town-rollup]')) {
        setExpanded(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
  }, [expanded])

  return (
    <div data-town-rollup className="relative flex flex-1 flex-col items-center justify-center">
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute bottom-full mb-2 flex flex-col items-stretch gap-1 rounded-xl border border-slate-800 bg-slate-950/95 p-1.5 shadow-xl shadow-black/60"
          >
            {TOWN_ITEMS.map((item) => {
              const icon = TAB_ICONS[item.id]
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id)
                    setExpanded(false)
                  }}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-xs font-medium ${
                    activeTab === item.id ? 'bg-sky-500/10 text-sky-300' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {icon && <NavIconGlyph icon={icon} />}
                  {item.label}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className={`flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium leading-tight ${
          active || expanded ? 'text-sky-300' : 'text-slate-400'
        }`}
      >
        <span className="text-lg">🏘️</span>
        <span className="truncate">Town</span>
      </button>
    </div>
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
        <TownNavButton />
        {RIGHT_ITEMS.map((item) => (
          <NavButton key={item.id} {...item} />
        ))}
      </div>
    </nav>
  )
}
