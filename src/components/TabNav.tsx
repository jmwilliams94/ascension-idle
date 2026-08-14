import { useTabStore, type TabId } from '../game/hud/useTabStore'
import { TAB_ICONS } from '../game/hud/navIcons'
import NavIconGlyph from './NavIconGlyph'
import { useAchievementsStore, totalClaimableCount } from '../game/achievements/useAchievementsStore'
import { useMailStore, countUnreadMail } from '../game/marketplace/useMailStore'

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

const TAB_BUTTON_CLASS =
  'flex flex-col items-center justify-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-medium transition-colors'

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

  return (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`relative ${TAB_BUTTON_CLASS} ${active ? 'border-amber-400 bg-amber-500/10 text-amber-300' : 'border-slate-700 text-slate-300 hover:border-amber-500/50'}`}
    >
      {icon && <NavIconGlyph icon={icon} sizeClassName="h-8 w-8" />}
      <span>{label}</span>
      {Boolean(badge) && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-900 bg-amber-500 px-1 text-[10px] font-bold text-slate-950">
          {badge! > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

// Desktop-only (`hidden lg:grid` — mobile has its own fixed bottom nav bar
// entirely, MobileBottomNav.tsx). Desktopified version of that bar (2026-08-03,
// confirmed with the user): same icon art, but all 8 tabs shown flat rather
// than mobile's Town rollup grouping — desktop has the horizontal room
// mobile doesn't, so the space-saving rollup isn't needed here. Combat
// (labeled "Idling") renders through the same generic TabButton as every
// other tab (2026-08-14) — it used to get its own special dynamic
// equipped-weapon-icon button, replaced by the static hourglass icon.
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
    <div className="hidden grid-cols-8 gap-2 lg:grid">
      {TAB_ITEMS.map((item) => (
        <TabButton
          key={item.id}
          id={item.id}
          label={item.label}
          badge={item.id === 'achievements' ? achievementsBadge : item.id === 'marketplace' ? mailBadge : undefined}
        />
      ))}
    </div>
  )
}
