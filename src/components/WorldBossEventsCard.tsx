import { useEffect, useState } from 'react'
import { AscensionCard } from './ui/AscensionCard'
import { useWorldBossStore } from '../game/worldboss/useWorldBossStore'

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m'
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

// Replaces "Zone & Monster" in Events mode. Also the explicit seam for the
// deferred gold-donation-event follow-up feature — see plan
// tranquil-knitting-acorn's Context section for why that's a separate plan.
export default function WorldBossEventsCard() {
  const spawn = useWorldBossStore((state) => state.spawn)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const windowEndsAtMs = spawn ? new Date(spawn.windowEndsAt).getTime() : 0
  const windowEnded = spawn ? windowEndsAtMs <= now : false

  return (
    <AscensionCard title="Events">
      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-center">
        <p className="text-heading-label">World Boss</p>
        {spawn ? (
          <p className="mt-1 text-sm text-slate-200">
            {windowEnded ? 'The fight has ended.' : `Ends in ${formatDuration(windowEndsAtMs - now)}`}
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">Loading…</p>
        )}
      </div>

      <div className="mt-2 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-3 text-center opacity-60">
        <p className="text-heading-label">Gold Donation Event</p>
        <p className="mt-1 text-xs text-slate-500">Coming soon</p>
      </div>
    </AscensionCard>
  )
}
