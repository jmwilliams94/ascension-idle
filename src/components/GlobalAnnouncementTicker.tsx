import { useState } from 'react'
import { useGlobalActivityStore } from '../game/social/useGlobalActivityStore'
import { useAnnouncementHistoryStore } from '../game/social/useAnnouncementHistoryStore'

// Extensible by kind (see 20260808050000_global_announcements.sql) --
// unrecognized future kinds fall back to the generic 📣 rather than needing
// a code change to render at all. The lucky_* set below was expanded
// 2026-08-10 (20260810020000_expand_lucky_announcements.sql) to cover
// anything at least as rare as Comet Scroll's own weight -- icons reused
// from LuckyPanel.tsx's own rewardVisual for the same kinds, for consistency.
// Exported so the "See more" history dropdown below can reuse the same
// kind->icon mapping instead of a second copy.
export const ANNOUNCEMENT_ICONS: Record<string, string> = {
  armor_socket: '💠',
  lucky_comet_scroll: '🎰',
  lucky_fallen_star_scroll: '🎰',
  lucky_fallen_star: '🌠',
  lucky_gem_tempered: '💎',
  lucky_gem_ascended: '💎',
  lucky_gear_radiant_bow: '🏹',
  lucky_gear_radiant_coat: '🥋',
  lucky_gear_ascended_random: '🗡️',
}

// The last-10-global-announcements dropdown (2026-08-11) — only reachable by
// manually reopening a collapsed ticker (see isManualReopen below), never
// shown on a fresh live announcement, so the ambient live-update toast stays
// exactly as lean as it always has. Combines both kinds (armor-socket procs
// + every announced Lucky Lad tier) in one feed, not split by source.
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
              <span className="shrink-0" aria-hidden="true">
                {ANNOUNCEMENT_ICONS[entry.kind] ?? '📣'}
              </span>
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
// "See more" (2026-08-11, confirmed with the user): a fresh live
// announcement never shows it -- only a *manual* reopen (tapping the
// collapsed 📣▸ pill) does, per the user's own framing ("on notifications
// that have just happened maybe don't include any kind of latest button but
// if a user manually hits the announcement expansion button it show the
// latest 1 as well as an option to see more"). isManualReopen tracks which
// of those two paths produced the current expanded state.
export default function GlobalAnnouncementTicker() {
  const announcement = useGlobalActivityStore((state) => state.latestAnnouncement)
  const loadHistory = useAnnouncementHistoryStore((state) => state.loadHistory)
  const [collapsed, setCollapsed] = useState(false)
  const [lastSeenId, setLastSeenId] = useState<string | null>(null)
  const [isManualReopen, setIsManualReopen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // Reset to the lean auto-expanded state during render when a genuinely new
  // announcement arrives (React's recommended "adjusting state when a prop
  // changes" pattern, https://react.dev/learn/you-might-not-need-an-effect)
  // rather than in a useEffect -- avoids the extra render pass an
  // effect-driven setState would cause.
  if (announcement && announcement.id !== lastSeenId) {
    setLastSeenId(announcement.id)
    setCollapsed(false)
    setIsManualReopen(false)
    setShowHistory(false)
  }

  if (!announcement) {
    return null
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => {
          setCollapsed(false)
          setIsManualReopen(true)
        }}
        aria-label="Show latest announcement"
        title="Show latest announcement"
        className="shrink-0 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-400 backdrop-blur hover:border-slate-500 hover:text-slate-200"
      >
        📣 ▸
      </button>
    )
  }

  return (
    <div className="relative min-w-0 max-w-full shrink sm:max-w-sm">
      <div className="flex items-center gap-2 rounded-lg border border-amber-600/50 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 backdrop-blur">
        <span className="shrink-0" aria-hidden="true">
          {ANNOUNCEMENT_ICONS[announcement.kind] ?? '📣'}
        </span>
        <span className="min-w-0 flex-1 truncate">{announcement.message}</span>
        {isManualReopen && (
          <button
            type="button"
            onClick={() => {
              const next = !showHistory
              setShowHistory(next)
              if (next) {
                void loadHistory()
              }
            }}
            className="shrink-0 text-[10px] font-normal text-amber-300/70 underline hover:text-amber-100"
          >
            {showHistory ? 'Hide' : 'See more'}
          </button>
        )}
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
