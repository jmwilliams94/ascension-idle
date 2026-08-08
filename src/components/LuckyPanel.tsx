import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  useLuckyStore,
  LUCKY_TICKET_AP_COST,
  LUCKY_CARD_COUNT,
  LUCKYLAD_ICON_SRC,
  CHEST_CLOSED_ICON_SRC,
  CHEST_OPEN_ICON_SRC,
  type LuckyReward,
} from '../game/lucky/useLuckyStore'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import {
  FALLEN_STAR_COLOR,
  FALLEN_STAR_ICON_SRC,
  FALLEN_STAR_SCROLL_ICON_SRC,
  MATERIAL_COLOR,
  COMET_ICON_SRC,
  COMET_SCROLL_ICON_SRC,
  getStoneIconSrc,
} from '../game/items/forgeCosts'
import { getGemTierColor } from '../game/items/gemTypes'
import { QUALITY_COLORS } from '../game/items/equipmentBonus'

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
    case 'comet':
      return 'Comet'
    case 'fallen_star':
      return 'Fallen Star'
    case 'comet_scroll':
      return 'Comet Scroll'
    case 'fallen_star_scroll':
      return 'Fallen Star Scroll'
    case 'money_bag':
      return `Class ${reward.amount} Money Bag`
    case 'gem_bag':
      return 'Random Gem Bag'
    case 'composition_stone':
      return `+${reward.amount} Stone`
    case 'gem_tempered':
      // The specific gem type is only decided once the draw actually
      // resolves the won card server-side (see draw_lucky_ticket) — every
      // board entry of this kind, won or not, only ever carries {kind, amount}.
      return 'Tempered Gem'
    case 'gem_ascended':
      return 'Ascended Gem'
    case 'gear_radiant_bow':
      return "Radiant Ranger's Bow"
    case 'gear_radiant_coat':
      return 'Radiant Fawnhide Coat'
    case 'gear_ascended_random':
      return 'Ascended Gear'
  }
}

function rewardVisual(reward: LuckyReward): { icon?: string; iconSrc?: string; color: string } {
  switch (reward.kind) {
    case 'gold':
      return { icon: '💰', color: '#F0B87A' }
    case 'comet':
      return { iconSrc: COMET_ICON_SRC, color: MATERIAL_COLOR }
    case 'fallen_star':
      return { iconSrc: FALLEN_STAR_ICON_SRC, color: FALLEN_STAR_COLOR }
    case 'comet_scroll':
      return { iconSrc: COMET_SCROLL_ICON_SRC, color: MATERIAL_COLOR }
    case 'fallen_star_scroll':
      return { iconSrc: FALLEN_STAR_SCROLL_ICON_SRC, color: FALLEN_STAR_COLOR }
    case 'money_bag':
      return { icon: '💰', color: FALLEN_STAR_COLOR }
    case 'gem_bag':
      return { icon: '🎁', color: MATERIAL_COLOR }
    case 'composition_stone':
      return { icon: '🔷', iconSrc: getStoneIconSrc(reward.amount), color: MATERIAL_COLOR }
    case 'gem_tempered':
      return { icon: '💎', color: getGemTierColor('tempered') }
    case 'gem_ascended':
      return { icon: '💎', color: getGemTierColor('ascended') }
    case 'gear_radiant_bow':
      return { icon: '🏹', color: QUALITY_COLORS.radiant }
    case 'gear_radiant_coat':
      return { icon: '🥋', color: QUALITY_COLORS.radiant }
    case 'gear_ascended_random':
      return { icon: '🗡️', color: QUALITY_COLORS.ascended }
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
      className={`relative flex aspect-[3/4] flex-col items-center justify-center gap-0.5 rounded-xl border-2 p-1 text-center transition-colors ${
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
          className="flex flex-col items-center gap-0.5"
        >
          {/* Opened chest as the reveal backdrop (real art, 2026-08-03) —
              same for every reward kind, with the reward's own icon overlaid
              as a small badge so the 9 revealed cards still read apart from
              each other at a glance. */}
          <div className="relative flex h-11 w-11 items-center justify-center">
            <img src={CHEST_OPEN_ICON_SRC} alt="" className="h-full w-full object-contain" />
            <div
              className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border text-[10px]"
              style={{ borderColor: visual.color, backgroundColor: `${visual.color}dd` }}
            >
              {visual.iconSrc ? <img src={visual.iconSrc} alt="" className="h-4/5 w-4/5 object-contain" /> : visual.icon}
            </div>
          </div>
          <p className="text-[9px] font-medium leading-tight text-slate-300">{rewardLabel(reward)}</p>
        </motion.div>
      ) : (
        <img src={CHEST_CLOSED_ICON_SRC} alt="" className="h-11 w-11 object-contain" />
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
  const lotteryTickets = useCurrencyStore((state) => state.lotteryTickets)

  const [armedIndex, setArmedIndex] = useState<number | null>(null)
  // Lottery Ticket (2026-08-06, Achievements rework) — a third payment
  // option the player can toggle on, independent of free/AP eligibility;
  // only offered when at least one is owned. Reset alongside armedIndex.
  const [useTicketPayment, setUseTicketPayment] = useState(false)
  const [board, setBoard] = useState<LuckyReward[] | null>(null)
  const [wonIndex, setWonIndex] = useState<number | null>(null)
  const [paymentUsed, setPaymentUsed] = useState<'free' | 'ascension_points' | 'lottery_ticket' | null>(null)
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
  const cost = useTicketPayment ? 0 : freeAvailable ? 0 : LUCKY_TICKET_AP_COST
  const canAffordArmed = useTicketPayment ? lotteryTickets >= 1 : freeAvailable || ascensionPoints >= LUCKY_TICKET_AP_COST

  const handlePick = (index: number) => {
    if (board || busy) return
    setError(null)
    setArmedIndex((current) => (current === index ? null : index))
  }

  const handleConfirm = async () => {
    if (armedIndex === null) return
    setError(null)
    const result = await draw(characterId, armedIndex, useTicketPayment)

    if (!result.ok || !result.board || typeof result.won_index !== 'number') {
      setError(
        result.error === 'not_enough_ap'
          ? `Not enough Ascension Points (need ${LUCKY_TICKET_AP_COST}).`
          : result.error === 'not_enough_lottery_tickets'
            ? "Not enough Lottery Tickets."
            : result.error === 'not_owner'
              ? "Couldn't verify this character owns that — try reloading the page."
              : result.error === 'not_enough_room'
                ? 'Your Inventory is full — free up a slot and try again.'
                : "Couldn't draw a ticket — try again.",
      )
      setArmedIndex(null)
      setUseTicketPayment(false)
      return
    }

    setBoard(result.board)
    setWonIndex(result.won_index)
    setPaymentUsed(result.payment ?? null)
    setArmedIndex(null)
    setUseTicketPayment(false)
  }

  const handleReset = () => {
    setBoard(null)
    setWonIndex(null)
    setPaymentUsed(null)
    setUseTicketPayment(false)
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-4">
        <div className="flex items-center gap-2">
          <img src={LUCKYLAD_ICON_SRC} alt="" className="h-8 w-8 object-contain" />
          <p className="text-sm font-semibold text-slate-200">LuckyLad</p>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Pick one of 9 chests for a shot at a reward — the rest reveal what they would have been, but only your pick counts.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          <span>
            Ascension Points: <span className="font-semibold text-purple-300">{ascensionPoints.toLocaleString()}</span>
          </span>
          <span>
            Lottery Tickets: <span className="font-semibold text-sky-300">{lotteryTickets.toLocaleString()}</span>
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

      {/* max-w-sm caps how wide each card can stretch on desktop — without
          it, grid-cols-3's fluid columns fill the whole (much wider) page
          width, and since each card is aspect-[3/4] (taller than wide), a
          wide card becomes proportionally very tall. */}
      <div className="mx-auto grid max-w-sm grid-cols-3 gap-2">
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
            {useTicketPayment
              ? 'This draw consumes 1 Lottery Ticket.'
              : freeAvailable
                ? 'This draw uses your free ticket.'
                : `This draw costs ${LUCKY_TICKET_AP_COST} Ascension Points.`}
          </p>
          {lotteryTickets >= 1 && (
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={useTicketPayment}
                onChange={(event) => setUseTicketPayment(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-sky-500"
              />
              Pay with a Lottery Ticket instead ({lotteryTickets} owned)
            </label>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || !canAffordArmed}
              onClick={() => void handleConfirm()}
              className="flex-1 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Drawing…' : `Confirm (${useTicketPayment ? '1 Ticket' : cost === 0 ? 'Free' : `${cost} AP`})`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setArmedIndex(null)
                setUseTicketPayment(false)
              }}
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
            {paymentUsed === 'ascension_points'
              ? ` (paid ${LUCKY_TICKET_AP_COST} AP)`
              : paymentUsed === 'lottery_ticket'
                ? ' (paid 1 Lottery Ticket)'
                : ' (free ticket)'}
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
