import { useTabStore, type TabId } from '../game/hud/useTabStore'
import { TAB_ICONS } from '../game/hud/navIcons'
import NavIconGlyph from './NavIconGlyph'
import { useAchievementsStore, totalClaimableCount } from '../game/achievements/useAchievementsStore'
import { useMailStore, countUnreadMail } from '../game/marketplace/useMailStore'
import { useActiveEventEmberColor } from '../game/hud/useEventEmberColor'
import { useLuckyFreeEmberColor } from '../game/hud/useLuckyFreeEmberColor'
import { EventEmberBorder } from '../game/hud/eventEmberBorder'
import { eventBorderTintStyle } from '../game/hud/eventEmberBorderData'
import { useTutorialStore } from '../game/tutorial/useTutorialStore'
import { TUTORIAL_STEP_IDS } from '../game/tutorial/tutorialSteps'

const TAB_ITEMS: { id: TabId; label: string }[] = [
  { id: 'combat', label: 'Idling' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'lucky', label: 'LuckyLad' },
  { id: 'forge', label: 'Forge' },
  { id: 'marketplace', label: 'Market' },
  { id: 'shop', label: 'Shop' },
  { id: 'bank', label: 'Bank' },
  { id: 'achievements', label: 'Achievements' },
]

// Same gold gradient/glow treatment as Fight/Buy/Confirm (.btn-gold in
// index.css, 2026-08-16) rather than a bespoke steel/amber border — .btn-gold
// for the idle state, .btn-gold-active in place of it (never alongside) for
// whichever tab is currently open, since .btn-gold-active is the permanently-
// lit variant of .btn-gold's own :hover state.
//
// Square icon-only buttons (2026-09-09, per the user — the left-hand sidebar
// redesign): aspect-square so each button's height always matches its own
// width (the sidebar column's fixed width — see the outer container below),
// no more flex-col + label underneath.
const TAB_BUTTON_CLASS = 'flex aspect-square w-full items-center justify-center rounded-xl'

// badge (2026-08-06, Achievements rework) — a small count bubble in the
// corner, currently only used for the Achievements tab (claimable tier
// count) but kept generic in case another tab wants one later, same
// "relative wrapper + absolute badge" pattern MarketplacePanel's own Mail
// sub-tab badge already established.
function TabButton({ id, label, badge }: { id: TabId; label: string; badge?: number }) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === id
  const icon = TAB_ICONS[id]

  // First-login tutorial (admin-only for now) — only the Forge tab is ever a
  // spotlighted step here (Lucky's own nav button is LuckyTabButton below).
  // Hook called unconditionally (rules-of-hooks) — the id === 'forge' check
  // is applied afterward, not inside the hook call itself.
  const isTutorialNavForgeStepActive = useTutorialStore((state) => state.isStepActive(TUTORIAL_STEP_IDS.navForge))
  const advanceTutorial = useTutorialStore((state) => state.advance)
  const isTutorialForgeStep = id === 'forge' && isTutorialNavForgeStepActive

  return (
    <div className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        data-tutorial-id={id === 'forge' ? 'nav-forge' : undefined}
        onClick={() => {
          setActiveTab(id)
          if (isTutorialForgeStep) {
            advanceTutorial()
          }
        }}
        className={`${TAB_BUTTON_CLASS} ${active ? 'btn-gold-active' : 'btn-gold'}`}
      >
        {icon && <NavIconGlyph icon={icon} sizeClassName="h-10 w-10" />}
      </button>
      {Boolean(badge) && (
        <span className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-900 bg-amber-500 px-1 text-[10px] font-bold text-slate-950">
          {badge! > 99 ? '99+' : badge}
        </span>
      )}
    </div>
  )
}

// Split out from TabButton, as its own component (rather than a prop on
// TabButton), so only the Idling tab subscribes to the Zone Boss / Gold
// Donation stores — the other 7 tabs don't need to re-render when those
// change. Same button markup as TabButton, plus the event-color outline
// ring and border embers layered on top — see useEventEmberColor.ts for the
// red/green/gold priority rule. EventEmberBorder renders as an unclipped
// sibling of the button, inside this outer `relative` wrapper div, rather
// than as a child of the button itself (2026-08-28, reported by the user:
// the old approach added .btn-ember-safe to the button whenever an event was
// live, which strips .btn-gold's overflow:hidden AND its ::before/::after
// glass highlight + hover light-sweep — so Idling visibly lost its normal
// chrome exactly while a Zone Boss fight was making it glow, which read as
// "this button is broken" rather than "this button is highlighted." Same
// sibling-wrapper fix AscensionCard already uses for its activeEventColor
// prop — see CLAUDE.visual-design.md.
function IdlingTabButton({ label }: { label: string }) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === 'combat'
  const icon = TAB_ICONS.combat
  const emberColor = useActiveEventEmberColor()

  // First-login tutorial (admin-only for now).
  const isTutorialStepActive = useTutorialStore((state) => state.isStepActive(TUTORIAL_STEP_IDS.navIdling))
  const advanceTutorial = useTutorialStore((state) => state.advance)

  return (
    <div className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        data-tutorial-id="nav-idling"
        onClick={() => {
          setActiveTab('combat')
          if (isTutorialStepActive) {
            advanceTutorial()
          }
        }}
        className={`${TAB_BUTTON_CLASS} ${active ? 'btn-gold-active' : 'btn-gold'}`}
        style={eventBorderTintStyle(emberColor)}
      >
        {icon && <NavIconGlyph icon={icon} sizeClassName="h-10 w-10" />}
      </button>
      <EventEmberBorder color={emberColor} />
    </div>
  )
}

// Same split-out treatment as IdlingTabButton above, so only the LuckyLad
// tab subscribes to useLuckyStore's nextFreeTicketAt — lights up with the
// same border-ember/outline-ring effect once the free 4h ticket is ready
// (2026-08-25, requested by the user).
function LuckyTabButton({ label }: { label: string }) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === 'lucky'
  const icon = TAB_ICONS.lucky
  const emberColor = useLuckyFreeEmberColor()

  // First-login tutorial (admin-only for now).
  const isTutorialStepActive = useTutorialStore((state) => state.isStepActive(TUTORIAL_STEP_IDS.navLucky))
  const advanceTutorial = useTutorialStore((state) => state.advance)

  return (
    <div className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        data-tutorial-id="nav-lucky"
        onClick={() => {
          setActiveTab('lucky')
          if (isTutorialStepActive) {
            advanceTutorial()
          }
        }}
        className={`${TAB_BUTTON_CLASS} ${active ? 'btn-gold-active' : 'btn-gold'}`}
        style={eventBorderTintStyle(emberColor)}
      >
        {icon && <NavIconGlyph icon={icon} sizeClassName="h-10 w-10" />}
      </button>
      <EventEmberBorder color={emberColor} />
    </div>
  )
}

// Desktop-only (`hidden lg:flex` — mobile has its own fixed bottom nav bar
// entirely, MobileBottomNav.tsx). Vertical icon-only sidebar (2026-09-09,
// per the user — supersedes the earlier horizontal 8-across row above the
// content: same icon art, no labels, bigger icons, square buttons), rendered
// down the left edge of the content area in GameShell rather than above it.
// All 8 tabs shown flat, same as the row version did — desktop has the
// vertical room mobile doesn't, so the space-saving Town rollup mobile uses
// isn't needed here. Combat (labeled "Idling") renders via its own
// IdlingTabButton (2026-08-16, so it alone subscribes to the event embers)
// rather than the generic TabButton every other tab uses.
export default function TabNav() {
  const characterKills = useAchievementsStore((state) => state.characterKills)
  const accountKills = useAchievementsStore((state) => state.accountKills)
  const zoneClaims = useAchievementsStore((state) => state.zoneClaims)
  const achievementsBadge = totalClaimableCount(characterKills, accountKills, zoneClaims)
  // Unclaimed Mail count (2026-08-13, requested by the user) — same badge
  // treatment as Achievements, mirroring MarketplacePanel's own Mail sub-tab
  // badge (see that file) so a pending purchase/returned-listing item is
  // visible from the nav bar too, not just after already opening Market.
  // Counts distinct unread mail (countUnreadMail — an Admin Mail send with 9
  // rewards is still 1 unread mail, not 9), fixed 2026-08-13 after an admin
  // send showed "9" for what was really one message. Derived outside the
  // selector on purpose (see the Zustand selector gotcha noted elsewhere in
  // this project) — the selector only ever returns the stable `entries`
  // array reference.
  const mailEntries = useMailStore((state) => state.entries)
  const mailBadge = countUnreadMail(mailEntries)

  return (
    <div className="hidden lg:flex lg:w-20 lg:shrink-0 lg:flex-col lg:gap-2">
      {TAB_ITEMS.map((item) =>
        item.id === 'combat' ? (
          <IdlingTabButton key={item.id} label={item.label} />
        ) : item.id === 'lucky' ? (
          <LuckyTabButton key={item.id} label={item.label} />
        ) : (
          <TabButton
            key={item.id}
            id={item.id}
            label={item.label}
            badge={item.id === 'achievements' ? achievementsBadge : item.id === 'marketplace' ? mailBadge : undefined}
          />
        ),
      )}
    </div>
  )
}
