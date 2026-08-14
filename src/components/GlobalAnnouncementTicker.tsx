import { useState } from 'react'
import { useGlobalActivityStore } from '../game/social/useGlobalActivityStore'
import { useAnnouncementHistoryStore } from '../game/social/useAnnouncementHistoryStore'
import { getGearIconSrc } from '../game/items/equipmentBonus'
import { getGemIconSrc, type GemTier, type GemTypeId } from '../game/items/gemCatalog'
import { COMET_SCROLL_ICON_SRC, FALLEN_STAR_SCROLL_ICON_SRC, FALLEN_STAR_ICON_SRC, COMET_BOX_ICON_SRC } from '../game/items/forgeCosts'

// Emoji fallback, kept for any kind resolveAnnouncementIconSrc can't turn
// into a real icon (an unrecognized future kind, or a gear name that isn't
// in ITEM_ICON_OVERRIDES yet). Exported so the "See more" history dropdown
// below can reuse the same fallback map instead of a second copy.
export const ANNOUNCEMENT_ICONS: Record<string, string> = {
  armor_socket: '💠',
  lucky_comet_box: '☄️',
  lucky_comet_scroll: '🎰',
  lucky_fallen_star_scroll: '🎰',
  lucky_fallen_star: '🌠',
  lucky_gem_tempered: '💎',
  lucky_gem_ascended: '💎',
  lucky_gear_radiant_bow: '🏹',
  lucky_gear_radiant_coat: '🥋',
  lucky_gear_ascended_random: '🗡️',
  level_130: '🏆',
}

const GEM_IDS: GemTypeId[] = ['drake', 'ember', 'bastion', 'iris']

// Real icon of the specific thing that was actually won, parsed out of the
// announcement's own free-text `message` (2026-08-13) -- supersedes the
// generic per-kind emoji above, which only said "a socket happened" or "a
// gem happened" rather than showing which gear/gem it actually was. There's
// no structured per-announcement reward data in the schema (global_announcements
// only stores kind/character_name/message, see 20260808050000_global_announcements.sql)
// so this parses the same fixed message shapes the SQL functions that insert
// these rows always produce (quality_upgrade/level_upgrade/master_forge_upgrade's
// "<name>'s <item> gained its 1st/2nd socket!" -- ordinal added 2026-08-14, see
// 20260814030000_socket_announcement_ordinal.sql --, draw_lucky_ticket's
// "<name> won a(n) <Tier> <Gem> Gem/Ascended <item> from LL!" -- "LL" since
// 2026-08-13, shortened from "Lucky Lad") -- brittle to a wording change
// there, but keeps this a client-only change with no migration.
// Returns undefined (falls back to the emoji above) if parsing or icon
// lookup fails, e.g. a gear name not yet in ITEM_ICON_OVERRIDES.
function resolveAnnouncementIconSrc(kind: string, message: string): string | undefined {
  switch (kind) {
    case 'armor_socket': {
      const match = message.match(/'s (.+) gained its (?:1st|2nd) socket!$/)
      return match ? getGearIconSrc(match[1]) : undefined
    }
    case 'lucky_comet_box':
      return COMET_BOX_ICON_SRC
    case 'lucky_comet_scroll':
      return COMET_SCROLL_ICON_SRC
    case 'lucky_fallen_star_scroll':
      return FALLEN_STAR_SCROLL_ICON_SRC
    case 'lucky_fallen_star':
      return FALLEN_STAR_ICON_SRC
    case 'lucky_gem_tempered':
    case 'lucky_gem_ascended': {
      const tier: GemTier = kind === 'lucky_gem_tempered' ? 'tempered' : 'ascended'
      const match = message.match(/won an? (?:Tempered|Ascended) (\w+) Gem/)
      const gemId = match?.[1]?.toLowerCase() as GemTypeId | undefined
      return gemId && GEM_IDS.includes(gemId) ? getGemIconSrc(gemId, tier) : undefined
    }
    case 'lucky_gear_radiant_bow':
      return getGearIconSrc("Ranger's Bow")
    case 'lucky_gear_radiant_coat':
      return getGearIconSrc('Fawnhide Coat')
    case 'lucky_gear_ascended_random': {
      const match = message.match(/won an Ascended (.+) from LL!$/)
      return match ? getGearIconSrc(match[1]) : undefined
    }
    default:
      return undefined
  }
}

// imgClassName sizes the real icon (fixed h/w + object-contain); the emoji
// fallback deliberately isn't forced into the same box — a fixed h/w would
// clip an emoji glyph rather than scale it — so it just gets a shrink-0 to
// match layout, sized by its surrounding text instead.
function AnnouncementIcon({ kind, message, imgClassName }: { kind: string; message: string; imgClassName: string }) {
  const iconSrc = resolveAnnouncementIconSrc(kind, message)
  if (iconSrc) {
    return <img src={iconSrc} alt="" className={imgClassName} />
  }
  return (
    <span className="shrink-0" aria-hidden="true">
      {ANNOUNCEMENT_ICONS[kind] ?? '📣'}
    </span>
  )
}

// The last-10-global-announcements dropdown (2026-08-11) — reachable via the
// "See more" toggle, which now always shows next to the current announcement
// (2026-08-13, previously only reachable after manually reopening a
// collapsed ticker). Combines both kinds (armor-socket procs + every
// announced LL tier) in one feed, not split by source.
function AnnouncementHistoryDropdown() {
  const entries = useAnnouncementHistoryStore((state) => state.entries)
  const loaded = useAnnouncementHistoryStore((state) => state.loaded)

  return (
    <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-900/95 p-2 shadow-xl backdrop-blur sm:w-80">
      <p className="px-1 pb-1.5 text-[10px] uppercase tracking-wide text-slate-500">Recent Activity</p>
      {!loaded ? (
        <p className="px-1 py-2 text-xs text-slate-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="px-1 py-2 text-xs text-slate-500">Nothing yet.</p>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 rounded-md px-1 py-1 text-xs text-slate-300">
              <AnnouncementIcon kind={entry.kind} message={entry.message} imgClassName="h-4 w-4 shrink-0 object-contain" />
              <span className="min-w-0 flex-1">{entry.message}</span>
              <span className="shrink-0 text-[10px] text-slate-600">{new Date(entry.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Shows only the single most recent global announcement by default, not a
// scrollable history (confirmed with the user, 2026-08-08 -- "a bit of a
// toast notification or chat displaying the most recent thing that's
// happened (just one thing)"). Collapses to a small tab on manual dismiss;
// collapsing is per-message, not a permanent opt-out -- the moment a
// genuinely new announcement arrives it re-expands on its own (and resets
// back to this lean state, dropping any "See more" history that was open).
// Renders nothing until the first announcement (live or seeded on connect)
// shows up -- see GlobalActivityConnection.tsx.
//
// "See more" (2026-08-11, originally gated to only a *manual* reopen of the
// collapsed 📣▸ pill; that gate was removed 2026-08-13 per the user's
// request -- it now always shows, on a fresh live announcement too).
export default function GlobalAnnouncementTicker() {
  const announcement = useGlobalActivityStore((state) => state.latestAnnouncement)
  const loadHistory = useAnnouncementHistoryStore((state) => state.loadHistory)
  const [collapsed, setCollapsed] = useState(false)
  const [lastSeenId, setLastSeenId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  // Reset to the lean auto-expanded state during render when a genuinely new
  // announcement arrives (React's recommended "adjusting state when a prop
  // changes" pattern, https://react.dev/learn/you-might-not-need-an-effect)
  // rather than in a useEffect -- avoids the extra render pass an
  // effect-driven setState would cause.
  if (announcement && announcement.id !== lastSeenId) {
    setLastSeenId(announcement.id)
    setCollapsed(false)
    setShowHistory(false)
  }

  if (!announcement) {
    return null
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Show latest announcement"
        title="Show latest announcement"
        className="shrink-0 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-400 backdrop-blur hover:border-slate-500 hover:text-slate-200 lg:px-3 lg:py-2 lg:text-sm"
      >
        📣 ▸
      </button>
    )
  }

  return (
    <div className="relative min-w-0 max-w-full shrink sm:max-w-sm">
      <div className="flex items-center gap-2 rounded-lg border border-amber-600/50 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 backdrop-blur lg:gap-3 lg:px-4 lg:py-2 lg:text-sm">
        <AnnouncementIcon kind={announcement.kind} message={announcement.message} imgClassName="h-4 w-4 shrink-0 object-contain lg:h-5 lg:w-5" />
        <span className="min-w-0 flex-1 truncate">{announcement.message}</span>
        <button
          type="button"
          onClick={() => {
            const next = !showHistory
            setShowHistory(next)
            if (next) {
              void loadHistory()
            }
          }}
          className="shrink-0 text-[10px] font-normal text-amber-300/70 underline hover:text-amber-100 lg:text-xs"
        >
          {showHistory ? 'Hide' : 'See more'}
        </button>
        <button
          type="button"
          onClick={() => {
            setCollapsed(true)
            setShowHistory(false)
          }}
          aria-label="Collapse announcement"
          title="Collapse"
          className="ml-1 shrink-0 text-amber-300/70 hover:text-amber-100"
        >
          ◂
        </button>
      </div>

      {showHistory && <AnnouncementHistoryDropdown />}
    </div>
  )
}
