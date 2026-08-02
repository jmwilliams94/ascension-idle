import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useLuckyStore, LUCKY_TICKET_AP_COST, LUCKY_CARD_COUNT, type LuckyReward } from '../game/lucky/useLuckyStore'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import { DRAGONBALL_COLOR, DRAGONBALL_ICON_SRC, MATERIAL_COLOR, METEOR_ICON_SRC } from '../game/items/forgeCosts'

// Lucky — Stage 1 (confirmed design, see CLAUDE.md's Lucky section and the
// draw_lucky_ticket migration's own header). A free ticket every 6 hours,
// plus uncapped paid extras at LUCKY_TICKET_AP_COST Ascension Points each.
//
// Two-step pick (arm, then Confirm/Cancel) rather than firing the draw the
// instant a card is tapped — matches this codebase's established Confirm/
// Cancel convention (Forge, Marketplace) and gives an escape hatch before an
// AP spend becomes irrevocable, without weakening the anti-cheat design at
// all: arming a card is purely local state, nothing is sent to the server
// (and nothing about the board exists anywhere) until Confirm actually calls
// draw_lucky_ticket with that index baked into the request.
function rewardLabel(reward: LuckyReward): string {
  switch (reward.kind) {
    case 'gold':
      return `${reward.amount.toLocaleString()} Gold`
    case 'meteor':
      return 'Meteor'
    case 'dragonball':
      return 'DragonBall'
    case 'meteor_scroll':
      return 'Meteor Scroll'
    case 'dragonball_scroll':
      return 'DragonBall Scroll'
  }
}

function rewardVisual(reward: LuckyReward): { icon?: string; iconSrc?: string; color: string } {
  switch (reward.kind) {
    case 'gold':
      return { icon: '💰', color: '#F0B87A' }
    case 'meteor':
      return { iconSrc: METEOR_ICON_SRC, color: MATERIAL_COLOR }
    case 'dragonball':
      return { iconSrc: DRAGONBALL_ICON_SRC, color: DRAGONBALL_COLOR }
    case 'meteor_scroll':
      return { icon: '📜', color: MATERIAL_COLOR }
    case 'dragonball_scroll':
      return { icon: '📜', color: DRAGONBALL_COLOR }
  }
}

function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

function LuckyCard({
  index,
  reward,
  won,
  onClick,
  armed,
  disabled,
}: {
  index: number
  reward: LuckyReward | null
  won: boolean
  onClick?: () => void
  armed: boolean
  disabled: boolean
}) {
  const visual = reward ? rewardVisual(reward) : null

  return (
    <button
      type="button"
      disabled={disabled || !onClick}
      onClick={onClick}
      className={`relative flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-xl border-2 p-1 text-center transition-colors ${
        won
          ? 'border-amber-400 bg-amber-500/10 shadow-lg shadow-amber-500/20'
          : armed
            ? 'border-sky-400 bg-sky-500/10'
            : reward
              ? 'border-slate-700 bg-slate-900/60 opacity-60'
              : 'border-slate-700 bg-slate-800 hover:border-slate-500'
      } disabled:cursor-not-allowed`}
    >
      {reward && visual ? (
        <motion.div
          initial={{ rotateY: 90, opacity: 0 }}
          animate={{ rotateY: 0, opacity: 1 }}
          transition={{ duration: 0.25, delay: won ? 0 : 0.15 + index * 0.06 }}
          className="flex flex-col items-center gap-1"
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg border text-base"
            style={{ borderColor: visual.color, backgroundColor: `${visual.color}22` }}
          >
            {visual.iconSrc ? <img src={visual.iconSrc} alt="" className="h-4/5 w-4/5 object-contain" /> : visual.icon}
          </div>
          <p className="text-[9px] font-medium leading-tight text-slate-300">{rewardLabel(reward)}</p>
        </motion.div>
      ) : (
        <span className="text-2xl">❓</span>
      )}
      {won && <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-slate-950">WON</span>}
    </button>
  )
}

export default function LuckyPanel({ characterId }: { characterId: string }) {
  const nextFreeTicketAt = useLuckyStore((state) => state.nextFreeTicketAt)
  const busy = useLuckyStore((state) => state.busy)
  const draw = useLuckyStore((state) => state.draw)
  const ascensionPoints = usePlayerRecordStore((state) => state.ascensionPoints)

  const [armedIndex, setArmedIndex] = useState<number | null>(null)
  const [board, setBoard] = useState<LuckyReward[] | null>(null)
  const [wonIndex, setWonIndex] = useState<number | null>(null)
  const [paymentUsed, setPaymentUsed] = useState<'free' | 'ascension_points' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Free-ticket countdown only needs to be roughly live, not to-the-second —
  // a 30s re-render is enough to keep the displayed "Xh Ym" honest. Reading
  // Date.now() into state here (rather than calling it directly during
  // render) keeps the component body itself pure, same pattern CombatPage's
  // own live countdown already uses.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  const freeAvailable = !nextFreeTicketAt || nextFreeTicketAt <= now
  const cost = freeAvailable ? 0 : LUCKY_TICKET_AP_COST
  const canAffordArmed = freeAvailable || ascensionPoints >= LUCKY_TICKET_AP_COST

  const handlePick = (index: number) => {
    if (board || busy) return
    setError(null)
    setArmedIndex((current) => (current === index ? null : index))
  }

  const handleConfirm = async () => {
    if (armedIndex === null) return
    setError(null)
    const result = await draw(characterId, armedIndex)

    if (!result.ok || !result.board || typeof result.won_index !== 'number') {
      setError(
        result.error === 'not_enough_ap'
          ? `Not enough Ascension Points (need ${LUCKY_TICKET_AP_COST}).`
          : result.error === 'not_owner'
            ? "Couldn't verify this character owns that — try reloading the page."
            : "Couldn't draw a ticket — try again.",
      )
      setArmedIndex(null)
      return
    }

    setBoard(result.board)
    setWonIndex(result.won_index)
    setPaymentUsed(result.payment ?? null)
    setArmedIndex(null)
  }

  const handleReset = () => {
    setBoard(null)
    setWonIndex(null)
    setPaymentUsed(null)
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🍀</span>
          <p className="text-sm font-semibold text-slate-200">Lucky</p>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Pick one of 9 cards for a shot at a reward — the rest reveal what they would have been, but only your pick counts.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          <span>
            Ascension Points: <span className="font-semibold text-purple-300">{ascensionPoints.toLocaleString()}</span>
          </span>
          <span>
            {freeAvailable ? (
              <span className="font-semibold text-emerald-400">Free ticket ready</span>
            ) : (
              <>Next free ticket in {formatCountdown(nextFreeTicketAt! - now)}</>
            )}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: LUCKY_CARD_COUNT }, (_, index) => (
          <LuckyCard
            key={index}
            index={index}
            reward={board ? board[index] : null}
            won={wonIndex === index}
            armed={armedIndex === index}
            disabled={busy || Boolean(board)}
            onClick={board ? undefined : () => handlePick(index)}
          />
        ))}
      </div>

      {!board && armedIndex !== null && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <p className="text-xs text-slate-400">
            {freeAvailable ? 'This draw uses your free ticket.' : `This draw costs ${LUCKY_TICKET_AP_COST} Ascension Points.`}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || !canAffordArmed}
              onClick={() => void handleConfirm()}
              className="flex-1 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Drawing…' : `Confirm (${cost === 0 ? 'Free' : `${cost} AP`})`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setArmedIndex(null)}
              className="flex-1 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {board && wonIndex !== null && (
        <div className="rounded-xl border border-amber-600 bg-amber-500/10 p-3 text-center">
          <p className="text-xs text-slate-300">
            You won <span className="font-semibold text-amber-300">{rewardLabel(board[wonIndex])}</span>
            {paymentUsed === 'ascension_points' ? ` (paid ${LUCKY_TICKET_AP_COST} AP)` : ' (free ticket)'}
          </p>
          <button
            type="button"
            onClick={handleReset}
            className="mt-2 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
          >
            Draw Again
          </button>
        </div>
      )}

      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  )
}
