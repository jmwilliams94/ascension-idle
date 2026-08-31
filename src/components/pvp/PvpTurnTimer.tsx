import { useEffect, useState } from 'react'
import { TURN_SECONDS } from '../../game/pvp/pvpConstants'

// Countdown bar off a server timestamp (duel.turn_deadline) — ticks locally
// every 250ms for a smooth bar rather than re-rendering off the realtime
// subscription, but the deadline itself always comes from the server, so a
// client clock skew only affects how smoothly the bar animates, never who
// actually wins the race (pvp_duel_apply_action re-checks the real deadline
// server-side regardless of what this shows).
export default function PvpTurnTimer({ deadline }: { deadline: string | null }) {
  // `now` is read (Date.now(), an impure call) only inside the lazy useState
  // initializer and the interval callback below — both sanctioned "effect
  // boundary" spots, never the render body itself. Ticks every 250ms while a
  // deadline is active; remainingMs is then a pure derivation of `now` +
  // `deadline` computed fresh each render.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!deadline) return undefined
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [deadline])

  if (!deadline) return null

  const remainingMs = Math.max(0, new Date(deadline).getTime() - now)
  const fraction = Math.min(1, remainingMs / (TURN_SECONDS * 1000))
  const seconds = Math.ceil(remainingMs / 1000)

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${fraction > 0.3 ? 'bg-amber-400' : 'bg-rose-500'}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span className="text-heading-label w-6 text-right tabular-nums">{seconds}</span>
    </div>
  )
}
