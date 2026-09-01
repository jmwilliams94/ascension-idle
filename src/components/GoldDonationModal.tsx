import { useState } from 'react'
import { Button } from './ui/Button'
import { HpBar } from './CombatPage'
import { useGoldDonationStore, type GoldDonationResult } from '../game/goldDonation/useGoldDonationStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { formatGoldAmount } from '../game/stats/formatGold'
import GoldDonationLeaderboardModal from './GoldDonationLeaderboardModal'
import { useLockBodyScroll } from '../lib/useLockBodyScroll'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_amount: 'Enter a valid amount.',
  not_owner: "Couldn't verify your character.",
  not_enough_gold: "You don't have that much Gold.",
  pool_not_collecting: 'Donations are closed right now — try again later.',
  rpc_failed: 'Something went wrong — try again.',
}

const DONATION_STEP = 250_000

// Opened from GoldDonationCard's Donate button — the slider stays a modal
// rather than moving inline onto the card, since a mid-slider donation is a
// deliberate one-shot action, not something to leave half-adjusted on a card
// the player might navigate away from. Shell mirrors
// ZoneBossLeaderboardModal.tsx's backdrop/click-outside pattern.
export default function GoldDonationModal({ characterId, onClose }: { characterId: string; onClose: () => void }) {
  const gold = useProgressionStore((state) => state.gold)
  const pool = useGoldDonationStore((state) => state.pool)
  const busy = useGoldDonationStore((state) => state.busy)
  const donate = useGoldDonationStore((state) => state.donate)
  useLockBodyScroll()

  // Slider max is capped by both what the player can afford AND what the
  // pool still needs to hit its target (requested by the user — donate_gold
  // itself doesn't clamp an over-target donation, it just adds the full
  // amount to total_donated, so nothing server-side stops the slider from
  // inviting more Gold than the event could ever use). The remaining-needed
  // half is rounded UP to the nearest step rather than left un-stepped, so a
  // remaining gap smaller than one step (e.g. 180k left) still allows one
  // step's worth of donation to finish it, instead of a maxAmount below
  // DONATION_STEP wrongly tripping the "need at least 250,000 Gold" message.
  const affordableMax = Math.max(0, Math.floor(gold / DONATION_STEP) * DONATION_STEP)
  const remainingToFulfill = pool ? Math.max(0, pool.targetAmount - pool.totalDonated) : Infinity
  const remainingStepAligned = remainingToFulfill > 0 ? Math.ceil(remainingToFulfill / DONATION_STEP) * DONATION_STEP : affordableMax
  const maxAmount = Math.max(0, Math.min(affordableMax, remainingStepAligned))
  const canAffordStep = maxAmount >= DONATION_STEP

  const [amount, setAmount] = useState(DONATION_STEP)
  const [lastResult, setLastResult] = useState<GoldDonationResult | null>(null)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)

  const clampedAmount = Math.min(amount, maxAmount)
  const canDonate = pool?.status === 'collecting' && !busy && canAffordStep && clampedAmount >= DONATION_STEP

  const handleDonate = async () => {
    if (!canDonate) return
    const result = await donate(characterId, clampedAmount)
    setLastResult(result)
    if (result.ok) {
      setAmount(DONATION_STEP)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xs space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-slate-100">Donate Gold</p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setLeaderboardOpen(true)}
              title="Leaderboard"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-1.5 text-sm hover:bg-amber-500/20"
            >
              🏆
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="text-slate-300 hover:text-slate-100">
              ✕
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-300">Your Gold: {formatGoldAmount(gold)}</p>

        {pool && (
          <div>
            <p className="text-xs text-slate-300">
              {formatGoldAmount(pool.totalDonated)} / {formatGoldAmount(pool.targetAmount)} donated
            </p>
            <div className="mt-1">
              <HpBar current={pool.totalDonated} max={pool.targetAmount} barColorClass="bg-amber-500" />
            </div>
          </div>
        )}

        {pool?.status !== 'collecting' && <p className="text-center text-xs text-slate-300">No pool is currently accepting donations.</p>}

        {pool?.status === 'collecting' && (
          <>
            {canAffordStep ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-300">Amount</span>
                  <span className="text-sm font-medium text-amber-300">{formatGoldAmount(clampedAmount)}</span>
                </div>
                <input
                  type="range"
                  min={DONATION_STEP}
                  max={maxAmount}
                  step={DONATION_STEP}
                  value={clampedAmount}
                  onChange={(event) => setAmount(Number(event.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>
            ) : (
              <p className="text-center text-xs text-slate-300">You need at least {formatGoldAmount(DONATION_STEP)} Gold to donate.</p>
            )}

            <Button variant="primary" disabled={!canDonate} onClick={() => void handleDonate()} className="w-full">
              {busy ? 'Donating…' : 'Donate'}
            </Button>
          </>
        )}

        {lastResult && !lastResult.ok && (
          <p className="text-center text-sm text-rose-400">{ERROR_MESSAGES[lastResult.error ?? 'rpc_failed'] ?? 'Something went wrong.'}</p>
        )}
        {lastResult?.ok && lastResult.triggered_buff && (
          <p className="text-center text-sm font-medium text-amber-300">Your donation triggered the event!</p>
        )}
        {lastResult?.ok && !lastResult.triggered_buff && (
          <p className="text-center text-sm text-amber-300">Thanks for donating!</p>
        )}
      </div>

      {leaderboardOpen && pool && (
        <GoldDonationLeaderboardModal characterId={characterId} poolId={pool.id} onClose={() => setLeaderboardOpen(false)} />
      )}
    </div>
  )
}
