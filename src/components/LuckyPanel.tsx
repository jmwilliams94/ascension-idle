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
  type LuckyRewardKind,
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
  buildCometTooltip,
  buildFallenStarTooltip,
  buildCometScrollTooltip,
  buildFallenStarScrollTooltip,
  buildStoneTooltip,
  buildMoneyBagTooltip,
  buildGemBagTooltip,
  MONEY_BAG_GOLD_BY_CLASS,
} from '../game/items/forgeCosts'
import { GEM_TYPES, formatGemTierLabel, getGemIconSrc, getGemTierColor, buildGemTooltip, type GemTier, type GemTypeId } from '../game/items/gemTypes'
import { QUALITY_COLORS, getGearIconSrc } from '../game/items/equipmentBonus'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import type { ItemTooltipData } from '../game/items/itemTooltip'

// Parses the gem type/tier back out of a gem_tempered_<id>/gem_ascended_<id>
// reward kind (see useLuckyStore.ts's LuckyRewardKind for why the gem
// identity now lives in the kind itself). Shared by the three switch
// statements below so each only needs one case block for all 8 gem kinds.
const GEM_REWARD_KIND_PATTERN = /^gem_(tempered|ascended)_(drake|ember|bastion|iris)$/

function parseGemRewardKind(kind: LuckyRewardKind): { tier: GemTier; gemId: GemTypeId } | null {
  const match = GEM_REWARD_KIND_PATTERN.exec(kind)
  return match ? { tier: match[1] as GemTier, gemId: match[2] as GemTypeId } : null
}

// Lucky — Stage 1 (confirmed design, see CLAUDE.md's Lucky section and the
// draw_lucky_ticket migration's own header). A free ticket every 6 hours,
// plus uncapped paid extras at LUCKY_TICKET_AP_COST Ascension Points each.
//
// Payment-first flow (2026-08-10, requested by the user, supersedes the
// earlier arm-a-card-then-Confirm/Cancel two-step): the player picks a
// payment method (Lottery Ticket / Ascension Points) up front, then a single
// tap on any chest fires the draw immediately with that payment baked in.
// Still no cheating surface — nothing about the board exists anywhere until
// the tap actually calls draw_lucky_ticket with that card index.
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
    case 'gem_tempered_drake':
    case 'gem_tempered_ember':
    case 'gem_tempered_bastion':
    case 'gem_tempered_iris':
    case 'gem_ascended_drake':
    case 'gem_ascended_ember':
    case 'gem_ascended_bastion':
    case 'gem_ascended_iris': {
      const gem = parseGemRewardKind(reward.kind)!
      return `${formatGemTierLabel(gem.tier)} ${GEM_TYPES[gem.gemId].displayName}`
    }
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
      return { icon: '💰', iconSrc: getGearIconSrc(`Class ${reward.amount} Money Bag`), color: FALLEN_STAR_COLOR }
    case 'gem_bag':
      return { icon: '🎁', color: MATERIAL_COLOR }
    case 'composition_stone':
      return { icon: '🔷', iconSrc: getStoneIconSrc(reward.amount), color: MATERIAL_COLOR }
    case 'gem_tempered_drake':
    case 'gem_tempered_ember':
    case 'gem_tempered_bastion':
    case 'gem_tempered_iris':
    case 'gem_ascended_drake':
    case 'gem_ascended_ember':
    case 'gem_ascended_bastion':
    case 'gem_ascended_iris': {
      const gem = parseGemRewardKind(reward.kind)!
      return { iconSrc: getGemIconSrc(gem.gemId, gem.tier), color: getGemTierColor(gem.tier) }
    }
    case 'gear_radiant_bow':
      return { icon: '🏹', color: QUALITY_COLORS.radiant }
    case 'gear_radiant_coat':
      return { icon: '🥋', color: QUALITY_COLORS.radiant }
    case 'gear_ascended_random':
      return { icon: '🗡️', color: QUALITY_COLORS.ascended }
  }
}

// Real hover tooltip content for a revealed board tile (2026-08-10, confirmed
// with the user), reusing the same builders every other Inventory tile in the
// game uses — see forgeCosts.ts (buildGemTooltip, gemTypes.ts, for the gem
// kinds — real per-gem-type tooltip since 2026-08-13, see LuckyRewardKind's
// own header for why). The three hyper-rare gear kinds still get a generic
// (not item-specific) tooltip since the board only ever carries {kind,
// amount} for those — the exact gear template isn't decided until the draw
// actually resolves the won card server-side.
function buildLuckyRewardTooltip(reward: LuckyReward): ItemTooltipData {
  switch (reward.kind) {
    case 'gold':
      return { title: 'Gold', icon: '💰', iconColor: '#F0B87A', stats: [`${reward.amount.toLocaleString()} gold`] }
    case 'comet':
      return buildCometTooltip()
    case 'fallen_star':
      return buildFallenStarTooltip()
    case 'comet_scroll':
      return buildCometScrollTooltip()
    case 'fallen_star_scroll':
      return buildFallenStarScrollTooltip()
    case 'money_bag':
      return buildMoneyBagTooltip(`Class ${reward.amount} Money Bag`, MONEY_BAG_GOLD_BY_CLASS[reward.amount] ?? 0)
    case 'gem_bag':
      return buildGemBagTooltip()
    case 'composition_stone':
      return buildStoneTooltip(reward.amount)
    case 'gem_tempered_drake':
    case 'gem_tempered_ember':
    case 'gem_tempered_bastion':
    case 'gem_tempered_iris':
    case 'gem_ascended_drake':
    case 'gem_ascended_ember':
    case 'gem_ascended_bastion':
    case 'gem_ascended_iris': {
      const gem = parseGemRewardKind(reward.kind)!
      const tooltip = buildGemTooltip(gem.gemId, gem.tier)
      return { ...tooltip, lines: ['Lucky Lad reward', ...(tooltip.lines ?? [])] }
    }
    case 'gear_radiant_bow':
      return {
        title: "Radiant Ranger's Bow",
        icon: '🏹',
        iconColor: QUALITY_COLORS.radiant,
        lines: ['Lucky Lad reward', 'Level 15, 2 empty sockets'],
      }
    case 'gear_radiant_coat':
      return {
        title: 'Radiant Fawnhide Coat',
        icon: '🥋',
        iconColor: QUALITY_COLORS.radiant,
        lines: ['Lucky Lad reward', 'Level 15, 2 empty sockets'],
      }
    case 'gear_ascended_random':
      return {
        title: 'Ascended Gear',
        icon: '🗡️',
        iconColor: QUALITY_COLORS.ascended,
        lines: ['Lucky Lad reward', 'Random class-appropriate item, level 15-70'],
      }
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
  disabled,
}: {
  index: number
  reward: LuckyReward | null
  won: boolean
  onClick?: () => void
  disabled: boolean
}) {
  const visual = reward ? rewardVisual(reward) : null

  // Note: the non-won "would have been" dimming below is applied only to the
  // chest art itself (see the opacity-60 on that <img>, not this container) —
  // putting it here used to cascade onto the InventorySlot's own solid
  // background too, making it translucent enough for the chest's golden
  // glow to bleed through behind the reward icon (reported by the user as
  // "too much opacity, looks unpolished").
  const containerClassName = `relative flex aspect-square items-center justify-center rounded-xl border-2 p-1 text-center transition-colors ${
    won
      ? 'border-amber-400 bg-amber-500/10 shadow-lg shadow-amber-500/20'
      : reward
        ? 'border-slate-700 bg-slate-900/60'
        : 'border-slate-700 bg-slate-800 hover:border-slate-500'
  } disabled:cursor-not-allowed`

  // Once revealed, this is no longer the pick button — it's an inert
  // container around a real InventorySlot tile (2026-08-10, confirmed with
  // the user: revealed tiles should be hoverable for their real tooltip and
  // match Inventory tile sizing/background effect). InventorySlot renders
  // its own <button>, so the outer element has to stop being one too — a
  // <button> can't contain another <button>.
  if (reward && visual) {
    return (
      <div className={containerClassName}>
        <motion.div
          initial={{ rotateY: 90, opacity: 0 }}
          animate={{ rotateY: 0, opacity: 1 }}
          transition={{ duration: 0.25, delay: won ? 0 : 0.15 + index * 0.06 }}
          className="relative flex h-full w-full items-center justify-center"
        >
          {/* Opened chest (real art, 2026-08-03) fills the card at the same
              size the shut chest did, sitting behind the reward as the
              reveal backdrop. The reward's own real Inventory tile
              (2026-08-10, confirmed with the user — same size/qualityColor
              background effect/hover tooltip as everywhere else in the
              game) sits centered on top of it — layered, not stacked, so
              both read at full size instead of sharing the card vertically. */}
          <img
            src={CHEST_OPEN_ICON_SRC}
            alt=""
            className={`absolute inset-0 h-full w-full object-contain ${won ? '' : 'opacity-60'}`}
          />
          {/* InventorySlot's own background is a light, deliberately-translucent
              qualityColor tint (see InventorySlot.tsx) — fine over the app's
              usual solid dark panels, but here it let the chest's bright glow
              show straight through, reading as washed out (reported by the
              user). A solid backdrop, sized/rounded to match the tile exactly,
              sits behind it so the icon reads on the same flat dark
              background every other Inventory tile has. */}
          <div className={`relative ${SLOT_SIZE_CLASS} rounded-lg bg-slate-900`}>
            <InventorySlot
              slotId={`lucky-${index}`}
              filled
              sizeClassName={SLOT_SIZE_CLASS}
              icon={visual.icon}
              iconSrc={visual.iconSrc}
              qualityColor={visual.color}
              label={rewardLabel(reward)}
              tooltip={buildLuckyRewardTooltip(reward)}
            />
          </div>
        </motion.div>
        {won && (
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-slate-950">
            WON
          </span>
        )}
      </div>
    )
  }

  return (
    <button type="button" disabled={disabled || !onClick} onClick={onClick} className={containerClassName}>
      <img src={CHEST_CLOSED_ICON_SRC} alt="" className="h-full w-full object-contain" />
    </button>
  )
}

export default function LuckyPanel({ characterId }: { characterId: string }) {
  const nextFreeTicketAt = useLuckyStore((state) => state.nextFreeTicketAt)
  const busy = useLuckyStore((state) => state.busy)
  const draw = useLuckyStore((state) => state.draw)
  const ascensionPoints = usePlayerRecordStore((state) => state.ascensionPoints)
  const lotteryTickets = useCurrencyStore((state) => state.lotteryTickets)

  const [paymentChoice, setPaymentChoice] = useState<'lottery_ticket' | 'ascension_points' | null>(null)
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
  const pointsCost = freeAvailable ? 0 : LUCKY_TICKET_AP_COST
  const canAffordTicket = lotteryTickets >= 1
  const canAffordPoints = freeAvailable || ascensionPoints >= LUCKY_TICKET_AP_COST

  const handleOpen = async (index: number) => {
    if (board || busy || !paymentChoice) return
    setError(null)
    const result = await draw(characterId, index, paymentChoice === 'lottery_ticket')

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
      return
    }

    setBoard(result.board)
    setWonIndex(result.won_index)
    setPaymentUsed(result.payment ?? null)
  }

  const handleReset = () => {
    setBoard(null)
    setWonIndex(null)
    setPaymentUsed(null)
    setError(null)
    setPaymentChoice(null)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-4">
        <div className="flex items-center gap-2">
          <img src={LUCKYLAD_ICON_SRC} alt="" className="h-8 w-8 object-contain" />
          <p className="text-sm font-semibold text-slate-200">LuckyLad</p>
        </div>
      </div>

      {!paymentChoice && !board && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <p className="text-xs text-slate-400">Choose how to pay for a draw:</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || !canAffordTicket}
              onClick={() => setPaymentChoice('lottery_ticket')}
              className="flex-1 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {`Lottery Ticket (${lotteryTickets} owned)`}
            </button>
            <button
              type="button"
              disabled={busy || !canAffordPoints}
              onClick={() => setPaymentChoice('ascension_points')}
              className="flex-1 rounded-lg border border-purple-500 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pointsCost === 0 ? 'Free Ticket' : `${pointsCost} AP`}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            {freeAvailable ? 'Free ticket ready' : `Next free ticket in ${formatCountdown(nextFreeTicketAt! - now)}`}
          </p>
        </div>
      )}

      {paymentChoice && !board && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-400">
            Tap a chest to open it — paying with{' '}
            {paymentChoice === 'lottery_ticket' ? 'a Lottery Ticket' : pointsCost === 0 ? 'your free ticket' : `${pointsCost} AP`}.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setPaymentChoice(null)}
            className="shrink-0 text-xs font-medium text-slate-400 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Change
          </button>
        </div>
      )}

      {/* max-w-sm caps how wide each card can stretch on desktop — without
          it, grid-cols-3's fluid columns fill the whole (much wider) page
          width, and since each card is aspect-[3/4] (taller than wide), a
          wide card becomes proportionally very tall.

          Shown from first load (not gated behind paymentChoice) — chests are
          just inert/dimmed until a payment method is picked above, rather
          than appearing only after that choice. */}
      <div className={`mx-auto grid max-w-sm grid-cols-3 gap-2 ${paymentChoice || board ? '' : 'opacity-50'}`}>
        {Array.from({ length: LUCKY_CARD_COUNT }, (_, index) => (
          <LuckyCard
            key={index}
            index={index}
            reward={board ? board[index] : null}
            won={wonIndex === index}
            disabled={busy || Boolean(board) || !paymentChoice}
            onClick={board || !paymentChoice ? undefined : () => void handleOpen(index)}
          />
        ))}
      </div>

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
