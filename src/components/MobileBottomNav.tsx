import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTabStore, type TabId } from '../game/hud/useTabStore'
import { TAB_ICONS } from '../game/hud/navIcons'
import NavIconGlyph from './NavIconGlyph'
import { useAchievementsStore, totalClaimableCount } from '../game/achievements/useAchievementsStore'
import { useMailStore, countUnreadMail } from '../game/marketplace/useMailStore'
import { useActiveEventEmberColor } from '../game/hud/useEventEmberColor'
import { useLuckyFreeEmberColor } from '../game/hud/useLuckyFreeEmberColor'
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
// Borderless tab redesign (2026-08-28, requested by the user — the old
// per-button .btn-gold/.btn-gold-active box made every tab read as an
// equally-weighted boxed button, competing with the Idling FAB instead of
// deferring to it) — the outer <button> is now just a plain tap target with
// no background/border of its own; only the active tab's icon+label gets a
// small .nav-pill-active pill behind it, sized to its own content instead of
// stretching edge-to-edge. This also retires the old outerCorner prop (see
// git history) — that existed only to match a boxed button's one true outer
// corner to the bar's own rounded-b-[3rem] mask, which is moot now that idle
// buttons have no box to clip, and the active pill sits well clear of the
// bar's physical edge (px-2 on the row below, unchanged).
function NavButton({ id, label, badge }: { id: TabId; label: string; badge?: number }) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === id
  const icon = TAB_ICONS[id]

  return (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className="relative flex flex-1 flex-col items-center justify-center rounded-lg py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400/50"
    >
      <span
        className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px] font-medium leading-tight transition-all ${
          active ? 'nav-pill-active' : 'text-slate-400'
        }`}
      >
        {icon && <NavIconGlyph icon={icon} />}
        <span className="truncate">{label}</span>
      </span>
      {Boolean(badge) && (
        <span className="absolute right-2 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-slate-900 bg-amber-500 px-1 text-[9px] font-bold text-slate-950">
          {badge! > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

// Compact flex-[0.85] sizing (flanks Idling, reads slightly smaller than
// the edge buttons), same borderless pill treatment as NavButton — plus the
// World-Boss-button's own border-ember/outline-ring effect, retriggered here
// by the free 4h ticket cooldown instead of a server event (2026-08-25,
// requested by the user). The ember/outline stay on the outer <button> (the
// full tap target), not the inner pill — a free-ticket-ready LuckyLad should
// still draw the eye via the ember ring even while idle/un-pilled, same as
// before the 2026-08-28 borderless redesign.
function LuckyNavButton({ label }: { label: string }) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === 'lucky'
  const icon = TAB_ICONS.lucky
  const emberColor = useLuckyFreeEmberColor()

  return (
    <button
      type="button"
      onClick={() => setActiveTab('lucky')}
      className="relative flex flex-[0.85] flex-col items-center justify-center rounded-lg py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400/50"
      style={eventBorderTintStyle(emberColor)}
    >
      <span
        className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px] font-medium leading-tight transition-all ${
          active ? 'nav-pill-active' : 'text-slate-400'
        }`}
      >
        {icon && <NavIconGlyph icon={icon} />}
        <span className="truncate">{label}</span>
      </span>
      <EventEmberBorder color={emberColor} count={20} />
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
    // flex-[0.85], not flex-1 (2026-08-16, requested by the user) — Tavern
    // flanks Idling the same way LuckyLad does (see LuckyNavButton), both
    // sized down slightly relative to the edge buttons (Equip/Achiev).
    <div data-tavern-rollup className="relative flex flex-[0.85] flex-col items-center justify-center">
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
            //
            // right-0 + min-w (2026-08-18, reported by the user: popout too
            // narrow, cutting off item text) — this wrapper is a `flex-[0.85]`
            // item with flex-basis 0%, and with left/right both auto an
            // absolutely-positioned child's shrink-to-fit width is computed
            // against that 0-basis containing block rather than its own
            // content on mobile Safari, squeezing the menu narrower than its
            // text. Pinning `right-0` anchors it to the container's actual
            // right edge (keeping it on-screen since Tavern sits near the
            // bar's right side) and `min-w-max` forces the width to the
            // widest item's intrinsic content size instead of shrinking.
            className="absolute bottom-full right-0 mb-2 min-w-max shadow-xl shadow-black/60"
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
        className="relative flex h-full w-full flex-col items-center justify-center rounded-lg py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400/50"
      >
        <span
          className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px] font-medium leading-tight transition-all ${
            active || expanded ? 'nav-pill-active' : 'text-slate-400'
          }`}
        >
          <img src={TAVERN_ICON_SRC} alt="Tavern" className="h-6 w-6 object-contain" />
          <span className="truncate">Tavern</span>
        </span>
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
      className="ascension-edge-t fixed inset-x-0 bottom-0 z-40 rounded-b-[3rem] bg-[linear-gradient(180deg,_var(--ascension-ink-soft)_0%,_var(--ascension-ink)_100%)] lg:hidden"
      // translateZ(0) (2026-08-19, reported by the user: nav bar drifting
      // upward with the page mid-scroll on mobile) forces this onto its own
      // GPU compositing layer up front -- kept even after the 2026-08-14
      // gold/steel pass dropped this bar's `backdrop-blur` (the original
      // trigger for the iOS Safari `position: fixed` detach bug this
      // guarded against), since it's a harmless no-cost defensive measure
      // for a fixed-position bar either way.
      //
      // rounded-b, no overflow-hidden (2026-08-16, requested by the user:
      // bar should "contour" to the phone's rounded bottom corners) —
      // border-radius clips this element's own background on its own,
      // without needing overflow-hidden. Equip/Achiev. no longer need a
      // matching outer-corner radius of their own (see NavButton's doc
      // comment — the 2026-08-28 borderless redesign removed their box
      // entirely, so there's nothing left to clip against this mask).
      // overflow-hidden was here originally too, to clip those buttons
      // flush to this same mask before they got their own now-removed
      // outerCorner radius (and before px-2 moved them off the physical
      // edge) — kept dropped now (2026-08-16, reported by the user:
      // Tavern's popup menu stopped registering taps) since it was also
      // silently clipping the Tavern rollup, which opens via `absolute
      // bottom-full` and pokes out above this box: content clipped by an
      // ancestor's overflow-hidden doesn't receive pointer events either,
      // so every rollup item was a dead zone once this got added.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)', transform: 'translateZ(0)' }}
    >
      <div className="mx-auto flex max-w-md items-stretch gap-1 px-2 py-1">
        {LEFT_ITEMS.map((item) =>
          item.id === 'lucky' ? (
            <LuckyNavButton key={item.id} label={item.label} />
          ) : (
            <NavButton key={item.id} {...item} />
          ),
        )}
        <IdlingNavButton />
        <TavernNavButton badges={{ marketplace: mailBadge }} />
        {RIGHT_ITEMS.map((item) => (
          <NavButton key={item.id} {...item} badge={item.id === 'achievements' ? achievementsBadge : undefined} />
        ))}
      </div>
    </nav>
  )
}
