import { useGlobalActivityStore } from '../game/social/useGlobalActivityStore'

// Live distinct-account count from Realtime Presence (see
// GlobalActivityConnection.tsx) -- 0 until the channel first syncs, which
// reads as a brief startup state rather than a loading spinner, matching
// the rest of the top HUD strip's "no loading state, just a steady default"
// convention.
//
// Compact dot+number only (2026-08-18, requested by the user) -- dropped the
// "Players Online:" label text since the dot + count reads fine on its own
// and takes less HUD-strip real estate now that the strip also has a Chat
// button in it. `title` keeps the meaning available on hover/long-press.
export default function PlayersOnlineHud() {
  const onlineCount = useGlobalActivityStore((state) => state.onlineCount)

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-xs font-medium text-slate-300 backdrop-blur"
      title="Players Online"
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
      {onlineCount}
    </div>
  )
}
