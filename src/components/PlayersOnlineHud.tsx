import { useGlobalActivityStore } from '../game/social/useGlobalActivityStore'

// Live distinct-account count from Realtime Presence (see
// GlobalActivityConnection.tsx) -- 0 until the channel first syncs, which
// reads as a brief startup state rather than a loading spinner, matching
// the rest of the top HUD strip's "no loading state, just a steady default"
// convention.
export default function PlayersOnlineHud() {
  const onlineCount = useGlobalActivityStore((state) => state.onlineCount)

  return (
    <div className="shrink-0 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 backdrop-blur">
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" aria-hidden="true" />
      Players Online: {onlineCount}
    </div>
  )
}
