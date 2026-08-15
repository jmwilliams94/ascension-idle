import { useEffect, useState } from 'react'
import { AscensionCard } from './ui/AscensionCard'
import { HpBar } from './CombatPage'
import { useWorldBossStore } from '../game/worldboss/useWorldBossStore'
import { getActiveGoldDonationEvent, useGoldDonationStore, type GoldDonationBuffCategory } from '../game/goldDonation/useGoldDonationStore'
import { formatGoldAmount } from '../game/stats/formatGold'
import GoldDonationModal from './GoldDonationModal'

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m'
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

const BUFF_CATEGORY_LABEL: Record<GoldDonationBuffCategory, string> = {
  exp: 'EXP gain',
  socket_unlock: 'Socket unlock chance',
  comet: 'Comet drop chance',
  fallen_star: 'Fallen Star drop chance',
  quality_tier: 'Quality/composition drop chance',
}

// Replaces "Zone & Monster" in Events mode.
export default function WorldBossEventsCard({ characterId }: { characterId?: string | null }) {
  const spawn = useWorldBossStore((state) => state.spawn)
  const pool = useGoldDonationStore((state) => state.pool)
  const [now, setNow] = useState(() => Date.now())
  const [donateOpen, setDonateOpen] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const windowEndsAtMs = spawn ? new Date(spawn.windowEndsAt).getTime() : 0
  const windowEnded = spawn ? windowEndsAtMs <= now : false

  const activeGoldDonationEvent = getActiveGoldDonationEvent(pool, now)
  const buffEndsAtMs = pool?.buffEndsAt ? new Date(pool.buffEndsAt).getTime() : 0

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

      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-center">
        <p className="text-heading-label">Gold Donation Event</p>
        {!pool ? (
          <p className="mt-1 text-sm text-slate-500">Loading…</p>
        ) : pool.status === 'collecting' ? (
          <>
            <p className="mt-1 text-sm text-slate-200">
              {formatGoldAmount(pool.totalDonated)} / {formatGoldAmount(pool.targetAmount)} donated
            </p>
            <div className="mt-1">
              <HpBar current={pool.totalDonated} max={pool.targetAmount} barColorClass="bg-amber-500" />
            </div>
            {characterId && (
              <button
                type="button"
                onClick={() => setDonateOpen(true)}
                className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
              >
                Donate
              </button>
            )}
          </>
        ) : activeGoldDonationEvent ? (
          <p className="mt-1 text-sm text-emerald-300">
            {BUFF_CATEGORY_LABEL[activeGoldDonationEvent.category]} x{activeGoldDonationEvent.multiplier} — ends in{' '}
            {formatDuration(buffEndsAtMs - now)}
          </p>
        ) : (
          // Deliberately generic — the gap between one pool ending and the
          // next opening is never surfaced to players (no countdown).
          <p className="mt-1 text-sm text-slate-500">No event active</p>
        )}
      </div>

      {donateOpen && characterId && <GoldDonationModal characterId={characterId} onClose={() => setDonateOpen(false)} />}
    </AscensionCard>
  )
}
