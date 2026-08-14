import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTabStore, type TabId } from '../game/hud/useTabStore'
import { TAB_ICONS } from '../game/hud/navIcons'
import NavIconGlyph from './NavIconGlyph'
import { useAchievementsStore, totalClaimableCount } from '../game/achievements/useAchievementsStore'
import { useMailStore, countUnreadMail } from '../game/marketplace/useMailStore'
import { APP_VERSION } from '../version'

const BASE_URL = import.meta.env.BASE_URL
// Cache-busts public/ art with a fixed filename — see navIcons.ts's own
// iconUrl doc comment for why this is needed on GitHub Pages/Cloudflare.
const TAVERN_ICON_SRC = `${BASE_URL}nav-icons/tavern.png?v=${APP_VERSION}`

// Fixed bottom nav bar, mobile-only (`lg:hidden` — desktop keeps TabNav.tsx
// unchanged, now `hidden lg:grid`). Combat is centered, labeled "Idling" —
// confirmed navigation-only, same as every other button here; it does NOT
// itself start/stop combat (that's still Combat's own Fight/Stop button,
// already built for mobile — see CombatPage.tsx).
//
// Restructured (2026-08-03, confirmed with the user) — supersedes the
// original flat 7-button layout (Equipment/Forge/Market | Fight | Shop/Bank/
// Achievements). Now 5 always-visible slots — Equip, Lucky (new tab, see
// LuckyPanel), Idling, Tavern, Achieve — with Market/Bank/Shop/Forge moved
// off the bar entirely into a "Tavern" rollup (TavernNavButton below) rather
// than each getting its own permanent slot. Desktop's TabNav.tsx is
// unaffected by this — it just shows all 8 tabs flat (room isn't scarce
// there the way it is on a phone-width bottom bar), Tavern is a mobile-only
// grouping concept, not a real tab of its own.
const LEFT_ITEMS: { id: TabId; label: string }[] = [
  { id: 'equipment', label: 'Equip' },
  // Renamed "Lucky" -> "LuckyLad" (2026-08-03, confirmed with the user,
  // wording + mascot art only) — real art now exists (public/lucky-icons/
  // luckylad.png), replacing the placeholder 🍀 emoji.
  { id: 'lucky', label: 'LuckyLad' },
]

// TavernNavButton's own rollup contents — everything that used to have its
// own permanent bottom-nav slot except Equipment/Achievements (which stayed
// put) and Combat (always centered). No art exists for Market yet, same
// established "mixed icon language until more art arrives" precedent as
// before this restructure.
const TAVERN_ITEMS: { id: TabId; label: string }[] = [
  { id: 'marketplace', label: 'Market' },
  { id: 'bank', label: 'Bank' },
  { id: 'shop', label: 'Shop' },
  { id: 'forge', label: 'Forge' },
]

const RIGHT_ITEMS: { id: TabId; label: string }[] = [{ id: 'achievements', label: 'Achiev.' }]

// badge (2026-08-06, Achievements rework) — a small count bubble, currently
// only used for the Achievements button (claimable tier count).
function NavButton({ id, label, badge }: { id: TabId; label: string; badge?: number }) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === id
  const icon = TAB_ICONS[id]

  return (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium leading-tight ${
        active ? 'text-amber-300' : 'text-slate-400'
      }`}
    >
      {icon && <NavIconGlyph icon={icon} />}
      <span className="truncate">{label}</span>
      {Boolean(badge) && (
        <span className="absolute right-2 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-slate-900 bg-amber-500 px-1 text-[9px] font-bold text-slate-950">
          {badge! > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

// Static hourglass icon (2026-08-14) — replaced the old dynamic
// equipped-weapon icon + live "Fighting"/"Idle" status text; label always
// reads "Idling" now, matching GameShell's page-heading rename.
function IdlingNavButton() {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === 'combat'
  const icon = TAB_ICONS.combat

  return (
    <button
      type="button"
      onClick={() => setActiveTab('combat')}
      className="flex flex-1 flex-col items-center justify-center gap-0.5"
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full border-2 shadow-lg ${
          active
            ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-amber-500/20'
            : 'border-slate-600 bg-slate-800 text-slate-300 shadow-black/30'
        }`}
      >
        {icon && <NavIconGlyph icon={icon} sizeClassName="h-7 w-7" />}
      </span>
      <span className={`text-[10px] font-semibold leading-tight ${active ? 'text-amber-300' : 'text-slate-400'}`}>Idling</span>
    </button>
  )
}

// Speed-dial style: tapping Tavern toggles a small stack of buttons rising
// up from directly above it (Market/Bank/Shop/Forge, see TAVERN_ITEMS)
// rather than navigating anywhere itself — "rolls the buttons upward," per
// the user's own framing. Picking one of the rolled-out items navigates and
// collapses the stack in one motion; tapping Tavern again while open
// collapses it without navigating; tapping anywhere else on the page also
// collapses it (the same outside-pointerdown-dismiss pattern
// GearEquipPopover already established in this codebase), so it doesn't
// linger open over an unrelated tab.
// badges (2026-08-13, requested by the user) — keyed by TabId, currently only
// Market (unclaimed Mail count) uses this; shown both on the individual
// rolled-out item and, summed, on the collapsed Tavern button itself so a
// pending item is visible without opening the rollup first.
function TavernNavButton({ badges }: { badges: Partial<Record<TabId, number>> }) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const [expanded, setExpanded] = useState(false)
  const active = TAVERN_ITEMS.some((item) => item.id === activeTab)
  const totalBadge = Object.values(badges).reduce<number>((sum, value) => sum + (value ?? 0), 0)

  useEffect(() => {
    if (!expanded) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-tavern-rollup]')) {
        setExpanded(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
  }, [expanded])

  return (
    <div data-tavern-rollup className="relative flex flex-1 flex-col items-center justify-center">
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute bottom-full mb-2 flex flex-col items-stretch gap-1 rounded-xl border border-slate-800 bg-slate-950/95 p-1.5 shadow-xl shadow-black/60"
          >
            {TAVERN_ITEMS.map((item) => {
              const icon = TAB_ICONS[item.id]
              const badge = badges[item.id]
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id)
                    setExpanded(false)
                  }}
                  className={`relative flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-xs font-medium ${
                    activeTab === item.id ? 'bg-amber-500/10 text-amber-300' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {icon && <NavIconGlyph icon={icon} />}
                  {item.label}
                  {Boolean(badge) && (
                    <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-slate-950">
                      {badge! > 99 ? '99+' : badge}
                    </span>
                  )}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className={`relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium leading-tight ${
          active || expanded ? 'text-amber-300' : 'text-slate-400'
        }`}
      >
        <img src={TAVERN_ICON_SRC} alt="Tavern" className="h-6 w-6 object-contain" />
        <span className="truncate">Tavern</span>
        {totalBadge > 0 && (
          <span className="absolute right-2 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-slate-900 bg-amber-500 px-1 text-[9px] font-bold text-slate-950">
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
      </button>
    </div>
  )
}

export default function MobileBottomNav() {
  const characterKills = useAchievementsStore((state) => state.characterKills)
  const accountKills = useAchievementsStore((state) => state.accountKills)
  const zoneClaims = useAchievementsStore((state) => state.zoneClaims)
  const achievementsBadge = totalClaimableCount(characterKills, accountKills, zoneClaims)
  // Unclaimed Mail count (2026-08-13, requested by the user) — see
  // TavernNavButton's own doc comment for how this surfaces on mobile, where
  // Market lives inside the Tavern rollup rather than its own top-level slot.
  // Counts distinct unread mail (countUnreadMail), not raw rows — see
  // TabNav.tsx's matching fix for why.
  const mailEntries = useMailStore((state) => state.entries)
  const mailBadge = countUnreadMail(mailEntries)

  return (
    <nav
      className="ascension-edge-t fixed inset-x-0 bottom-0 z-40 bg-[linear-gradient(180deg,_var(--ascension-ink-soft)_0%,_var(--ascension-ink)_100%)] lg:hidden"
      // translateZ(0) (2026-08-19, reported by the user: nav bar drifting
      // upward with the page mid-scroll on mobile) forces this onto its own
      // GPU compositing layer up front -- kept even after the 2026-08-14
      // gold/steel pass dropped this bar's `backdrop-blur` (the original
      // trigger for the iOS Safari `position: fixed` detach bug this
      // guarded against), since it's a harmless no-cost defensive measure
      // for a fixed-position bar either way.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)', transform: 'translateZ(0)' }}
    >
      <div className="mx-auto flex max-w-md items-stretch px-1">
        {LEFT_ITEMS.map((item) => (
          <NavButton key={item.id} {...item} />
        ))}
        <IdlingNavButton />
        <TavernNavButton badges={{ marketplace: mailBadge }} />
        {RIGHT_ITEMS.map((item) => (
          <NavButton key={item.id} {...item} badge={item.id === 'achievements' ? achievementsBadge : undefined} />
        ))}
      </div>
    </nav>
  )
}
