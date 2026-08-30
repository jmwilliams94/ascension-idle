import { useEffect, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import {
  useLuckyStore,
  LUCKY_TICKET_AP_COST,
  LUCKY_BULK_AP_COST,
  LUCKY_BULK_TICKET_COST,
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
  COMET_BOX_ICON_SRC,
  COMET_SCROLL_ICON_SRC,
  getStoneIconSrc,
  buildCometTooltip,
  buildFallenStarTooltip,
  buildCometScrollTooltip,
  buildFallenStarScrollTooltip,
  buildCometBoxTooltip,
  buildStoneTooltip,
  buildMoneyBagTooltip,
  buildGemBagTooltip,
  buildVipTokenTooltip,
  VIP_TOKEN_COLOR,
  VIP_TOKEN_ICON_SRC,
  MONEY_BAG_GOLD_BY_CLASS,
} from '../game/items/forgeCosts'
import { GEM_TYPES, formatGemTierLabel, getGemIconSrc, getGemTierColor, buildGemTooltip, type GemTier, type GemTypeId } from '../game/items/gemTypes'
import { QUALITY_COLORS, getGearIconSrc } from '../game/items/equipmentBonus'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import type { ItemTooltipData } from '../game/items/itemTooltip'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'

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
// draw_lucky_ticket migration's own header). A free ticket every 4 hours
// (lowered from 6, requested by the user), plus uncapped paid extras at
// LUCKY_TICKET_AP_COST Ascension Points each.
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
    case 'comet_box':
      return 'Comet Box'
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
    case 'moon_box':
      return 'Lunar Chest'
    case 'vip_token':
      return 'VIP Token'
  }
}

function rewardVisual(reward: LuckyReward): { icon?: string; iconSrc?: string; color: string } {
  switch (reward.kind) {
    case 'gold':
      return { icon: '💰', color: '#F0B87A' }
    case 'comet':
      return { iconSrc: COMET_ICON_SRC, color: MATERIAL_COLOR }
    case 'comet_box':
      return { iconSrc: COMET_BOX_ICON_SRC, color: MATERIAL_COLOR }
    case 'fallen_star':
      return { iconSrc: FALLEN_STAR_ICON_SRC, color: FALLEN_STAR_COLOR }
    case 'comet_scroll':
      return { iconSrc: COMET_SCROLL_ICON_SRC, color: MATERIAL_COLOR }
    case 'fallen_star_scroll':
      return { iconSrc: FALLEN_STAR_SCROLL_ICON_SRC, color: FALLEN_STAR_COLOR }
    case 'money_bag':
      return { icon: '💰', iconSrc: getGearIconSrc(`Class ${reward.amount} Money Bag`), color: FALLEN_STAR_COLOR }
    case 'gem_bag':
      return { icon: '🎁', iconSrc: getGearIconSrc('Random Gem Bag'), color: MATERIAL_COLOR }
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
    case 'moon_box':
      return { icon: '📦', iconSrc: getGearIconSrc('Lunar Chest'), color: MATERIAL_COLOR }
    case 'vip_token':
      return { icon: '👑', iconSrc: VIP_TOKEN_ICON_SRC, color: VIP_TOKEN_COLOR }
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
    case 'comet_box':
      return buildCometBoxTooltip()
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
    case 'moon_box':
      return { title: 'Lunar Chest', icon: '📦', iconColor: MATERIAL_COLOR, lines: ['Lucky Lad reward'] }
    case 'vip_token':
      return buildVipTokenTooltip()
  }
}

// Seconds to hold on the won card alone before the other 8 flip — long
// enough to read as a deliberate pause, not an accident of stagger math.
const REVEAL_BATCH_DELAY_S = 0.5

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
  dim = false,
  revealDelay = 0,
  onClick,
  disabled,
}: {
  index: number
  reward: LuckyReward | null
  won: boolean
  // Whether a revealed-but-not-won card should render its chest art dimmed
  // — true for the single draw's 8 "informational only" cards (real prizes
  // exist on every card in a bulk draw, so its reveals always pass false;
  // see LuckyPanel's per-mode dim calc below).
  dim?: boolean
  // Seconds to hold before this card's flip animation starts. The single
  // draw stages this (0 for the won card, a small stagger for the other 8
  // "would have been" reveals); the bulk draw always passes 0 — each card
  // flips the instant its own click reveals it, no batching. Defaulted
  // rather than derived from `won`/`index` inside this component so both
  // callers can express their own timing.
  revealDelay?: number
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
        : 'border-slate-700 bg-slate-800 hover:border-amber-500/60'
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
          transition={{ duration: 0.25, delay: revealDelay }}
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
            className={`absolute inset-0 h-full w-full object-contain ${dim ? 'opacity-60' : ''}`}
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
  const drawBulk = useLuckyStore((state) => state.drawBulk)
  const revealBulkCard = useLuckyStore((state) => state.revealBulkCard)
  const ascensionPoints = usePlayerRecordStore((state) => state.ascensionPoints)
  const lotteryTickets = useCurrencyStore((state) => state.lotteryTickets)

  const [paymentChoice, setPaymentChoice] = useState<'lottery_ticket' | 'ascension_points' | null>(null)
  const [board, setBoard] = useState<LuckyReward[] | null>(null)
  const [wonIndex, setWonIndex] = useState<number | null>(null)
  const [paymentUsed, setPaymentUsed] = useState<'free' | 'ascension_points' | 'lottery_ticket' | null>(null)
  // Bulk draw ("Open All 9" for LUCKY_BULK_AP_COST AP) — every one of the 9
  // cards on `board` is a real reward once this is true, granted all at once
  // by drawBulk before any card is clicked. revealedIndices tracks which
  // ones the player has actually tapped open so far; the reveal itself is
  // purely a local animation gate, not another server round-trip.
  const [isBulk, setIsBulk] = useState(false)
  const [bulkPayment, setBulkPayment] = useState<'ascension_points' | 'lottery_ticket' | null>(null)
  const [revealedIndices, setRevealedIndices] = useState<Set<number>>(new Set())
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
  const canAffordBulk = ascensionPoints >= LUCKY_BULK_AP_COST
  const canAffordBulkTickets = lotteryTickets >= LUCKY_BULK_TICKET_COST

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

  // Bulk draw: payment happens the moment this fires (no card pick needed —
  // every card gets a real reward), then the board sits fully-granted but
  // face-down until handleRevealBulkCard flips each one open on tap.
  // useTickets picks the 8-Lottery-Ticket path instead of the default 160 AP.
  const handleBulkDraw = async (useTickets: boolean) => {
    if (board || busy) return
    setError(null)
    const result = await drawBulk(characterId, useTickets)

    if (!result.ok || !result.board) {
      setError(
        result.error === 'not_enough_ap'
          ? `Not enough Ascension Points (need ${LUCKY_BULK_AP_COST}).`
          : result.error === 'not_enough_lottery_tickets'
            ? `Not enough Lottery Tickets (need ${LUCKY_BULK_TICKET_COST}).`
            : result.error === 'not_owner'
              ? "Couldn't verify this character owns that — try reloading the page."
              : result.error === 'not_enough_room'
                ? 'Your Inventory needs at least 9 free slots — free some up and try again.'
                : "Couldn't draw — try again.",
      )
      return
    }

    setBoard(result.board)
    setIsBulk(true)
    setBulkPayment(useTickets ? 'lottery_ticket' : 'ascension_points')
    setRevealedIndices(new Set())
  }

  const handleRevealBulkCard = (index: number) => {
    if (!board || busy || revealedIndices.has(index)) return
    setRevealedIndices((prev) => new Set(prev).add(index))
    revealBulkCard(characterId, index)
  }

  const handleReset = () => {
    setBoard(null)
    setWonIndex(null)
    setPaymentUsed(null)
    setError(null)
    setPaymentChoice(null)
    setIsBulk(false)
    setBulkPayment(null)
    setRevealedIndices(new Set())
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center">
        <img src={LUCKYLAD_ICON_SRC} alt="" className="h-8 w-8 object-contain" />
      </div>

      {/* max-w-sm caps how wide each card can stretch on desktop — without
          it, grid-cols-3's fluid columns fill the whole (much wider) page
          width, and since each card is aspect-[3/4] (taller than wide), a
          wide card becomes proportionally very tall.

          Shown from first load (not gated behind paymentChoice) — chests are
          just inert/dimmed until a payment method is picked below, rather
          than appearing only after that choice. Sits above the payment
          controls (2026-08-10, requested by the user) so header + chests +
          controls all fit on one mobile screen without scrolling, and so
          picking a payment method doesn't shift the chests around. */}
      <div className={`mx-auto grid max-w-sm grid-cols-3 gap-2 ${paymentChoice || board ? '' : 'opacity-50'}`}>
        {Array.from({ length: LUCKY_CARD_COUNT }, (_, index) => (
          <LuckyCard
            key={index}
            index={index}
            reward={board && (!isBulk || revealedIndices.has(index)) ? board[index] : null}
            won={!isBulk && wonIndex === index}
            dim={!isBulk && wonIndex !== index}
            revealDelay={isBulk ? 0 : wonIndex === index ? 0 : REVEAL_BATCH_DELAY_S + index * 0.02}
            disabled={busy || (isBulk ? !board || revealedIndices.has(index) : Boolean(board) || !paymentChoice)}
            onClick={
              isBulk
                ? board
                  ? () => handleRevealBulkCard(index)
                  : undefined
                : board || !paymentChoice
                  ? undefined
                  : () => void handleOpen(index)
            }
          />
        ))}
      </div>

      {!paymentChoice && !board && (
        <AscensionCard contentClassName="p-3">
          {/* 2x2 grid of square buttons on mobile (2026-08-23, requested by
              the user — a 4th option needed room without stretching the
              button row into a cluttered 4-across line); a single row of 4 on
              desktop (2026-08-30, requested by the user — desktop has the
              horizontal room mobile doesn't). max-w-[220px] + mx-auto keeps
              the mobile grid narrower than the card, leaving visible spacing
              on both sides rather than filling the container edge to edge;
              lg:max-w-[480px] widens it back out for the 4-across row. Left
              column pays with Lottery Tickets (both gold, same Button
              primary treatment — same currency, same color, per
              CLAUDE.visual-design.md's guardrail); right column pays with
              Ascension Points (purple = single entry, emerald = bulk,
              unchanged from before). Top row = single draw, bottom row =
              9-for-8 bulk. Desktop reorders via lg:order-* to read Lottery
              Ticket / 9-for-8 / One Entry / 160 AP left to right (requested
              by the user) without touching the mobile 2x2 order, which stays
              DOM order. "Choose how to pay" label removed 2026-08-28,
              requested by the user — the four payment buttons below are
              self-explanatory without it. */}
          <div className="mx-auto grid max-w-[220px] grid-cols-2 gap-2 lg:max-w-[480px] lg:grid-cols-4">
            <Button
              variant="primary"
              disabled={busy || !canAffordTicket}
              onClick={() => setPaymentChoice('lottery_ticket')}
              className="flex aspect-square flex-col items-center justify-center gap-0.5 text-center leading-tight lg:order-1"
            >
              <span>Lottery</span>
              <span>Ticket</span>
              <span className="text-[10px] font-normal normal-case tracking-normal text-amber-200/70">{lotteryTickets} owned</span>
            </Button>
            <button
              type="button"
              disabled={busy || !canAffordPoints}
              onClick={() => setPaymentChoice('ascension_points')}
              style={{ '--glow-bright': '#c084fc', '--glow-base': '#a855f7', '--glow-dark': '#7e22ce' } as CSSProperties}
              className="btn-glow flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2.5 text-center font-heading text-sm font-bold uppercase leading-tight tracking-[0.12em] disabled:cursor-not-allowed lg:order-3"
            >
              <span>One</span>
              <span>Entry</span>
              <span className="text-[10px] font-normal normal-case tracking-normal text-purple-300/70">
                {pointsCost === 0 ? 'Free' : `${pointsCost} AP`}
              </span>
            </button>
            {/* Bulk draws — pay 8 Lottery Tickets or LUCKY_BULK_AP_COST AP
                (both "9 chests for the price of 8") up front and every one of
                the 9 chests holds a real reward, opened one at a time
                afterward. Fire immediately on click rather than going through
                paymentChoice, since both skip the "pick a chest" step
                entirely. */}
            <button
              type="button"
              disabled={busy || !canAffordBulkTickets}
              onClick={() => void handleBulkDraw(true)}
              className="btn-gold flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2.5 text-center font-heading text-sm font-bold uppercase leading-tight tracking-[0.12em] disabled:cursor-not-allowed lg:order-2"
            >
              <span>9 for 8</span>
              <span className="text-[10px] font-normal normal-case tracking-normal text-amber-200/70">{LUCKY_BULK_TICKET_COST} Tickets</span>
            </button>
            <button
              type="button"
              disabled={busy || !canAffordBulk}
              onClick={() => void handleBulkDraw(false)}
              style={{ '--glow-bright': '#34d399', '--glow-base': '#10b981', '--glow-dark': '#047857' } as CSSProperties}
              className="btn-glow flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2.5 text-center font-heading text-sm font-bold uppercase leading-tight tracking-[0.12em] disabled:cursor-not-allowed lg:order-4"
            >
              <span>9 for 8</span>
              <span className="text-[10px] font-normal normal-case tracking-normal text-emerald-300/70">{LUCKY_BULK_AP_COST} AP</span>
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            {freeAvailable ? 'Free ticket ready' : `Next free ticket in ${formatCountdown(nextFreeTicketAt! - now)}`}
          </p>
        </AscensionCard>
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

      {isBulk && board && revealedIndices.size < LUCKY_CARD_COUNT && (
        <p className="text-center text-xs text-slate-400">
          Tap a chest to open it — {revealedIndices.size}/{LUCKY_CARD_COUNT} opened.
        </p>
      )}

      {board && !isBulk && wonIndex !== null && (
        <div className="rounded-xl border border-amber-600 bg-amber-500/10 p-3 text-center">
          <p className="text-xs text-slate-300">
            You won <span className="font-semibold text-amber-300">{rewardLabel(board[wonIndex])}</span>
            {paymentUsed === 'ascension_points'
              ? ` (paid ${LUCKY_TICKET_AP_COST} AP)`
              : paymentUsed === 'lottery_ticket'
                ? ' (paid 1 Lottery Ticket)'
                : ' (free ticket)'}
          </p>
          <Button variant="secondary" onClick={handleReset} className="mt-2">
            Draw Again
          </Button>
        </div>
      )}

      {board && isBulk && revealedIndices.size === LUCKY_CARD_COUNT && (
        <div className="rounded-xl border border-amber-600 bg-amber-500/10 p-3 text-center">
          <p className="text-xs text-slate-300">
            All 9 opened{' '}
            <span className="font-semibold text-amber-300">
              (paid {bulkPayment === 'lottery_ticket' ? `${LUCKY_BULK_TICKET_COST} Lottery Tickets` : `${LUCKY_BULK_AP_COST} AP`})
            </span>
          </p>
          <Button variant="secondary" onClick={handleReset} className="mt-2">
            Draw Again
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  )
}
