import { useState } from 'react'
import { Button } from './ui/Button'
import { HpBar } from './CombatPage'
import { useGoldDonationStore, type GoldDonationResult } from '../game/goldDonation/useGoldDonationStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { formatGoldAmount } from '../game/stats/formatGold'
import GoldDonationLeaderboardModal from './GoldDonationLeaderboardModal'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_amount: 'Enter a valid amount.',
  not_owner: "Couldn't verify your character.",
  not_enough_gold: "You don't have that much Gold.",
  pool_not_collecting: 'Donations are closed right now — try again later.',
  rpc_failed: 'Something went wrong — try again.',
}

// Opened from WorldBossEventsCard's Gold Donation Event summary block. Not a
// third permanent card — the Events sub-mode only has two slots (top card,
// fight card), both already used by WorldBossEventsCard/WorldBossCard, so a
// modal is the cleanest fit for one donate input. Shell mirrors
// WorldBossLeaderboardModal.tsx's backdrop/click-outside pattern.
export default function GoldDonationModal({ characterId, onClose }: { characterId: string; onClose: () => void }) {
  const gold = useProgressionStore((state) => state.gold)
  const pool = useGoldDonationStore((state) => state.pool)
  const busy = useGoldDonationStore((state) => state.busy)
  const donate = useGoldDonationStore((state) => state.donate)

  const [amount, setAmount] = useState('')
  const [lastResult, setLastResult] = useState<GoldDonationResult | null>(null)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)

  const parsedAmount = Math.floor(Number(amount))
  const canDonate = pool?.status === 'collecting' && !busy && Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= gold

  const handleDonate = async () => {
    if (!canDonate) return
    const result = await donate(characterId, parsedAmount)
    setLastResult(result)
    if (result.ok) {
      setAmount('')
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
            <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-300">
              ✕
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-500">Your Gold: {formatGoldAmount(gold)}</p>

        {pool && (
          <div>
            <p className="text-xs text-slate-500">
              {formatGoldAmount(pool.totalDonated)} / {formatGoldAmount(pool.targetAmount)} donated
            </p>
            <div className="mt-1">
              <HpBar current={pool.totalDonated} max={pool.targetAmount} barColorClass="bg-amber-500" />
            </div>
          </div>
        )}

        {pool?.status !== 'collecting' && <p className="text-center text-xs text-slate-500">No pool is currently accepting donations.</p>}

        {pool?.status === 'collecting' && (
          <>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Amount"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-amber-500/60 focus:outline-none"
            />

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
