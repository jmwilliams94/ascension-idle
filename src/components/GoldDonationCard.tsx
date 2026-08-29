import { useState } from 'react'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import { HpBar } from './CombatPage'
import { getActiveGoldDonationEvent, useGoldDonationStore, type GoldDonationBuffCategory } from '../game/goldDonation/useGoldDonationStore'
import { formatGoldAmount } from '../game/stats/formatGold'
import GoldDonationModal from './GoldDonationModal'
import GoldDonationLeaderboardModal from './GoldDonationLeaderboardModal'
import type { EventEmberColor } from '../game/hud/useEventEmberColor'

const BUFF_CATEGORY_LABEL: Record<GoldDonationBuffCategory, string> = {
  exp: 'EXP gain',
  socket_unlock: 'Socket unlock chance',
  comet: 'Comet drop chance',
  fallen_star: 'Fallen Star drop chance',
  quality_tier: 'Quality/composition drop chance',
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m'
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

// Its own full card (2026-10-11, requested by the user — previously just a
// summary block stacked inside WorldBossEventsCard, with the donate slider
// only reachable through GoldDonationModal). Mirrors ZoneBossCard.tsx's
// shape (title + trophy, big icon tile, status line, HpBar, action button)
// so the two events read as equal-weight siblings in Events mode — see
// EventsCardStack.tsx for how the two are ordered and which gets
// `emberColor`.
export default function GoldDonationCard({
  characterId,
  now,
  emberColor,
}: {
  characterId?: string | null
  now: number
  emberColor: EventEmberColor | null
}) {
  const pool = useGoldDonationStore((state) => state.pool)
  const [donateOpen, setDonateOpen] = useState(false)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)

  const activeGoldDonationEvent = getActiveGoldDonationEvent(pool, now)
  const buffEndsAtMs = pool?.buffEndsAt ? new Date(pool.buffEndsAt).getTime() : 0

  return (
    <AscensionCard activeEventColor={emberColor}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-heading-label" style={{ fontSize: '1.4rem' }}>
            Gold Donation Event
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {!pool
              ? 'Loading…'
              : pool.status === 'collecting'
                ? 'Collecting donations'
                : activeGoldDonationEvent
                  ? 'Buff active'
                  : 'No event active'}
          </p>
        </div>
        {pool && characterId && (
          <button
            type="button"
            onClick={() => setLeaderboardOpen(true)}
            title="Leaderboard"
            className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-lg hover:bg-amber-500/20"
          >
            🏆
          </button>
        )}
      </div>

      <div className="mt-3 flex h-32 w-32 items-center justify-center rounded-2xl border-2 border-slate-700 bg-gradient-to-br from-amber-900 to-slate-950 text-5xl">
        💰
      </div>

      {!pool ? (
        <p className="mt-3 text-center text-sm text-slate-500">Loading…</p>
      ) : pool.status === 'collecting' ? (
        <>
          <div className="mt-3">
            <p className="text-xs text-slate-500">
              {formatGoldAmount(pool.totalDonated)} / {formatGoldAmount(pool.targetAmount)} donated
            </p>
            <div className="mt-1">
              <HpBar current={pool.totalDonated} max={pool.targetAmount} barColorClass="bg-amber-500" />
            </div>
          </div>
          {characterId && (
            <Button variant="primary" onClick={() => setDonateOpen(true)} className="mt-3 w-full">
              Donate
            </Button>
          )}
        </>
      ) : activeGoldDonationEvent ? (
        <p className="mt-3 text-center text-sm text-emerald-300">
          {BUFF_CATEGORY_LABEL[activeGoldDonationEvent.category]} x{activeGoldDonationEvent.multiplier} — ends in{' '}
          {formatDuration(buffEndsAtMs - now)}
        </p>
      ) : (
        // Deliberately generic — the gap between one pool ending and the
        // next opening is never surfaced to players (no countdown).
        <p className="mt-3 text-center text-sm text-slate-500">No event active</p>
      )}

      {donateOpen && characterId && <GoldDonationModal characterId={characterId} onClose={() => setDonateOpen(false)} />}
      {leaderboardOpen && pool && characterId && (
        <GoldDonationLeaderboardModal characterId={characterId} poolId={pool.id} onClose={() => setLeaderboardOpen(false)} />
      )}
    </AscensionCard>
  )
}
