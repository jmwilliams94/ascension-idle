import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTabStore, type TabId } from '../game/hud/useTabStore'
import { TAB_ICONS } from '../game/hud/navIcons'
import NavIconGlyph from './NavIconGlyph'
import { useAchievementsStore, totalClaimableCount } from '../game/achievements/useAchievementsStore'
import { useMailStore, countUnreadMail } from '../game/marketplace/useMailStore'
import { useActiveEventEmberColor } from '../game/hud/useEventEmberColor'
import { EventEmberBorder } from '../game/hud/eventEmberBorder'
import { eventBorderTintStyle } from '../game/hud/eventEmberBorderData'
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
// put) and Combat (always centered).
const TAVERN_ITEMS: { id: TabId; label: string }[] = [
  { id: 'marketplace', label: 'Market' },
  { id: 'bank', label: 'Bank' },
  { id: 'shop', label: 'Shop' },
  { id: 'forge', label: 'Forge' },
]

const RIGHT_ITEMS: { id: TabId; label: string }[] = [{ id: 'achievements', label: 'Achiev.' }]

// badge (2026-08-06, Achievements rework) — a small count bubble, currently
// only used for the Achievements button (claimable tier count).
// Same .btn-gold/.btn-gold-active treatment as TabNav.tsx's desktop buttons
// (2026-08-16, requested by the user — "same button styling we've been
// going with"), scaled down to this bar's compact size.
// outerCorner (2026-08-16, requested by the user) — Equip/Achiev. are the
// bar's two physical end buttons, so their one true outer-bottom corner gets
// a radius matching the nav's own rounded-b-[1.75rem] (see MobileBottomNav's
// className comment below) instead of the shared rounded-lg. Written as four
// explicit longhand corners rather than mixing the `rounded-lg` shorthand
// with a longhand override — both compile to the same border-radius
// longhand at equal specificity, so which one wins would depend on
// generated-CSS source order instead of JSX order.
function NavButton({
  id,
  label,
  badge,
  outerCorner,
}: {
  id: TabId
  label: string
  badge?: number
  outerCorner?: 'bl' | 'br'
}) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === id
  const icon = TAB_ICONS[id]
  const cornerClass =
    outerCorner === 'bl'
      ? 'rounded-tl-lg rounded-tr-lg rounded-br-lg rounded-bl-[1.75rem]'
      : outerCorner === 'br'
        ? 'rounded-tl-lg rounded-tr-lg rounded-bl-lg rounded-br-[1.75rem]'
        : 'rounded-lg'

  return (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium leading-tight ${cornerClass} ${
        active ? 'btn-gold-active' : 'btn-gold'
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
// Circle now uses the same .btn-gold/.btn-gold-active treatment as the rest
// of the nav (2026-08-16) instead of its own bespoke amber/slate colors, and
// carries the World Boss/Gold Donation Event border embers — see
// useEventEmberColor.ts for the red/green/gold priority rule.
// Sized up (h-11 -> h-14, 2026-08-16, requested by the user) so the center
// action button reads as the primary one — the row's items-stretch cross-
// axis means the whole nav bar's height grows to match this circle, and the
// four side NavButtons re-center within that taller row for free (they
// already use justify-center on a stretched flex child, see NavButton).
// flex-none w-16, not flex-1 (2026-08-16, requested by the user) — the real
// source of the "huge gap" either side of this button wasn't the row's
// gap-1 (two earlier passes tweaking that via negative margin barely moved
// the needle): as a flex-1 item this column was exactly as wide as the
// other four, but unlike them it's not a box filled edge-to-edge, it's a
// 56px circle centered inside, so ~15-17px of dead transparent space sat
// between the circle and each neighbor even with margin at 0. Fixing this
// button's own column to a width close to the circle (64px) removes that
// dead space at the source, and hands the freed-up width back to the other
// four flex-1 columns automatically.
function IdlingNavButton() {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === 'combat'
  const icon = TAB_ICONS.combat
  const emberColor = useActiveEventEmberColor()

  return (
    <button
      type="button"
      onClick={() => setActiveTab('combat')}
      className="flex w-16 flex-none flex-col items-center justify-center gap-0.5"
    >
      <span
        className={`relative flex h-14 w-14 items-center justify-center rounded-full shadow-lg ${
          active ? 'btn-gold-active shadow-amber-500/20' : 'btn-gold shadow-black/30'
        }`}
        style={eventBorderTintStyle(emberColor)}
      >
        {icon && <NavIconGlyph icon={icon} sizeClassName="h-9 w-9" />}
        <EventEmberBorder color={emberColor} count={20} />
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
            // `absolute` lives on this wrapper, not the .ascension-chip-frame
            // div below — that class sets its own `position: relative` in
            // index.css, and since @import 'tailwindcss' sits at the top of
            // that file, its rule wins the cascade over Tailwind's `.absolute`
            // utility when both land on one element (same specificity, later
            // source order wins). Putting them on separate elements avoids
            // the conflict entirely (bit once, 2026-08-15 — silently dropped
            // this popout back into normal document flow, stretching the
            // bottom nav bar instead of floating above it).
            className="absolute bottom-full mb-2 shadow-xl shadow-black/60"
          >
            <div className="ascension-chip-frame">
              <div className="ascension-chip-inner flex flex-col items-stretch gap-0.5 p-1">
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
                      className={`relative flex items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-xs font-medium ${
                        activeTab === item.id ? 'bg-amber-500/10 text-amber-300' : 'text-slate-300 hover:bg-slate-800/80'
                      }`}
                    >
                      {icon && <NavIconGlyph icon={icon} sizeClassName="h-5 w-5" />}
                      {item.label}
                      {Boolean(badge) && (
                        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-slate-950">
                          {badge! > 99 ? '99+' : badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className={`relative flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium leading-tight ${
          active || expanded ? 'btn-gold-active' : 'btn-gold'
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
      className="ascension-edge-t fixed inset-x-0 bottom-0 z-40 overflow-hidden rounded-b-[1.75rem] bg-[linear-gradient(180deg,_var(--ascension-ink-soft)_0%,_var(--ascension-ink)_100%)] lg:hidden"
      // translateZ(0) (2026-08-19, reported by the user: nav bar drifting
      // upward with the page mid-scroll on mobile) forces this onto its own
      // GPU compositing layer up front -- kept even after the 2026-08-14
      // gold/steel pass dropped this bar's `backdrop-blur` (the original
      // trigger for the iOS Safari `position: fixed` detach bug this
      // guarded against), since it's a harmless no-cost defensive measure
      // for a fixed-position bar either way.
      //
      // rounded-b + overflow-hidden (2026-08-16, requested by the user: bar
      // should "contour" to the phone's rounded bottom corners) — the outer
      // Equip/Achiev. buttons sit flush against the row's edges (no px on
      // the inner row below) so this mask clips straight through their own
      // square corners into the same arc, rather than hand-matching a
      // border-radius to a device corner radius CSS can't actually read.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)', transform: 'translateZ(0)' }}
    >
      <div className="mx-auto flex max-w-md items-stretch gap-1 py-1">
        {LEFT_ITEMS.map((item, index) => (
          <NavButton key={item.id} {...item} outerCorner={index === 0 ? 'bl' : undefined} />
        ))}
        <IdlingNavButton />
        <TavernNavButton badges={{ marketplace: mailBadge }} />
        {RIGHT_ITEMS.map((item) => (
          <NavButton
            key={item.id}
            {...item}
            badge={item.id === 'achievements' ? achievementsBadge : undefined}
            outerCorner="br"
          />
        ))}
      </div>
    </nav>
  )
}
