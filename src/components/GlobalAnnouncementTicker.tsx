import { useState } from 'react'
import { useGlobalActivityStore } from '../game/social/useGlobalActivityStore'

// Extensible by kind (see 20260808050000_global_announcements.sql) --
// unrecognized future kinds fall back to the generic 📣 rather than needing
// a code change to render at all. The lucky_* set below was expanded
// 2026-08-10 (20260810020000_expand_lucky_announcements.sql) to cover
// anything at least as rare as Comet Scroll's own weight -- icons reused
// from LuckyPanel.tsx's own rewardVisual for the same kinds, for consistency.
const ANNOUNCEMENT_ICONS: Record<string, string> = {
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

// Shows only the single most recent global announcement, not a scrollable
// history (confirmed with the user, 2026-08-08 -- "a bit of a toast
// notification or chat displaying the most recent thing that's happened
// (just one thing)"). Collapses to a small tab on manual dismiss;
// collapsing is per-message, not a permanent opt-out -- the moment a
// genuinely new announcement arrives it re-expands on its own. Renders
// nothing until the first announcement (live or seeded on connect) shows up
// -- see GlobalActivityConnection.tsx.
export default function GlobalAnnouncementTicker() {
  const announcement = useGlobalActivityStore((state) => state.latestAnnouncement)
  const [collapsed, setCollapsed] = useState(false)
  const [lastSeenId, setLastSeenId] = useState<string | null>(null)

  // Reset collapsed state during render when a genuinely new announcement
  // arrives (React's recommended "adjusting state when a prop changes"
  // pattern, https://react.dev/learn/you-might-not-need-an-effect) rather
  // than in a useEffect -- avoids the extra render pass an effect-driven
  // setState would cause.
  if (announcement && announcement.id !== lastSeenId) {
    setLastSeenId(announcement.id)
    setCollapsed(false)
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
        className="shrink-0 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-400 backdrop-blur hover:border-slate-500 hover:text-slate-200"
      >
        📣 ▸
      </button>
    )
  }

  return (
    <div className="flex min-w-0 max-w-full shrink items-center gap-2 rounded-lg border border-amber-600/50 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 backdrop-blur sm:max-w-sm">
      <span className="shrink-0" aria-hidden="true">
        {ANNOUNCEMENT_ICONS[announcement.kind] ?? '📣'}
      </span>
      <span className="min-w-0 truncate">{announcement.message}</span>
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        aria-label="Collapse announcement"
        title="Collapse"
        className="ml-1 shrink-0 text-amber-300/70 hover:text-amber-100"
      >
        ◂
      </button>
    </div>
  )
}
