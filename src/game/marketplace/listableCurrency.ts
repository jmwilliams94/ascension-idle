import {
  FALLEN_STAR_COLOR,
  FALLEN_STAR_ICON_SRC,
  FALLEN_STAR_SCROLL_ICON_SRC,
  MATERIAL_COLOR,
  COMET_ICON_SRC,
  COMET_SCROLL_ICON_SRC,
  COMET_BOX_ICON_SRC,
  VIP_TOKEN_COLOR,
  VIP_TOKEN_ICON_SRC,
  buildCometTooltip,
  buildFallenStarTooltip,
  buildCometScrollTooltip,
  buildFallenStarScrollTooltip,
  buildCometBoxTooltip,
  buildVipTokenTooltip,
} from '../items/forgeCosts'
import type { ItemTooltipData } from '../items/itemTooltip'
import type { ListableCurrencyType } from './useMarketplaceStore'
import type { MailCurrencyType } from './useMailStore'

// Small display helpers shared by MarketplaceListingSlot (the "List an Item"
// drop target) and MarketplacePanel's listing/mail tile rendering — kept
// here rather than duplicated in both, since the icon/color/label for each
// of the 4 listable currency types needs to stay consistent everywhere a
// currency-type listing or Mail entry renders.
export function listableCurrencyLabel(type: ListableCurrencyType): string {
  switch (type) {
    case 'comet':
      return 'Comet'
    case 'fallen_star':
      return 'Fallen Star'
    case 'comet_scroll':
      return 'Comet Scroll'
    case 'fallen_star_scroll':
      return 'Fallen Star Scroll'
  }
}

export interface ListableCurrencyVisual {
  icon?: string
  iconSrc?: string
  qualityColor: string
}

export function listableCurrencyVisual(type: ListableCurrencyType): ListableCurrencyVisual {
  switch (type) {
    case 'comet':
      return { iconSrc: COMET_ICON_SRC, qualityColor: MATERIAL_COLOR }
    case 'fallen_star':
      return { iconSrc: FALLEN_STAR_ICON_SRC, qualityColor: FALLEN_STAR_COLOR }
    case 'comet_scroll':
      return { iconSrc: COMET_SCROLL_ICON_SRC, qualityColor: MATERIAL_COLOR }
    case 'fallen_star_scroll':
      return { iconSrc: FALLEN_STAR_SCROLL_ICON_SRC, qualityColor: FALLEN_STAR_COLOR }
  }
}

// Ascension Points' own purple, matching the gain-toast color already used
// for it elsewhere (InventoryPanel.tsx's sellSelected toast). Mail-only —
// Lottery Tickets/Ascension Points are never marketplace-listable, so these
// wrappers exist alongside (not merged into) the functions above, which stay
// scoped to what a player can actually list for sale.
const ASCENSION_POINTS_COLOR = '#a855f7'
// Real art (already used by ExpBar.tsx/SalvageRevealToast.tsx, each with
// their own local copy of this same constant — following that established
// per-file pattern rather than centralizing it) — fixed 2026-08-13, reported
// by the user: mail tiles were showing a 🎖️ medal emoji instead of this.
const ASCENSION_POINTS_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/ascension-points.webp`
// Real art (2026-09-30), supersedes the 🎫 emoji everywhere a Lottery Ticket
// tile renders — same per-file local-const pattern as ASCENSION_POINTS_ICON_SRC
// above (Lottery Ticket is Mail/LuckyLad-only, never marketplace-listable).
const LOTTERY_TICKET_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/lottery-ticket.webp`

// Gold's own color, matching ExpBar.tsx's top-HUD gold readout convention.
const GOLD_COLOR = '#F0B87A'

export function mailCurrencyLabel(type: MailCurrencyType): string {
  if (type === 'lottery_ticket') return 'Lottery Ticket'
  if (type === 'ascension_points') return 'Ascension Points'
  if (type === 'gold') return 'Gold'
  if (type === 'comet_box') return 'Comet Box'
  if (type === 'vip_token') return 'VIP Token'
  return listableCurrencyLabel(type)
}

export function mailCurrencyVisual(type: MailCurrencyType): ListableCurrencyVisual {
  if (type === 'lottery_ticket') return { iconSrc: LOTTERY_TICKET_ICON_SRC, qualityColor: MATERIAL_COLOR }
  if (type === 'ascension_points') return { iconSrc: ASCENSION_POINTS_ICON_SRC, qualityColor: ASCENSION_POINTS_COLOR }
  if (type === 'gold') return { icon: '💰', qualityColor: GOLD_COLOR }
  if (type === 'comet_box') return { iconSrc: COMET_BOX_ICON_SRC, qualityColor: MATERIAL_COLOR }
  if (type === 'vip_token') return { iconSrc: VIP_TOKEN_ICON_SRC, qualityColor: VIP_TOKEN_COLOR }
  return listableCurrencyVisual(type)
}

// Mail tile hover tooltip (2026-08-13, reported by the user: Comet/Fallen
// Star/etc. tiles had no working tooltip at all — only gear tiles did,
// since InventorySlot's `tooltip` prop was never being passed for currency
// entries). Reuses the same builders forgeCosts.ts already exposes for the
// 4 shared types (so the tooltip content matches what those tiles show
// everywhere else in the app) and adds two new ones for Lottery
// Ticket/Ascension Points, which never had a tile anywhere before Mail.
// `amount` (a mail row can now carry more than 1 unit, see the amount
// column added by 20260813100000_admin_mail.sql) is appended as an extra
// stat line when greater than 1.
export function mailCurrencyTooltip(type: MailCurrencyType, amount?: number | null): ItemTooltipData {
  const base: ItemTooltipData =
    type === 'lottery_ticket'
      ? {
          title: 'Lottery Ticket',
          iconSrc: LOTTERY_TICKET_ICON_SRC,
          iconColor: MATERIAL_COLOR,
          lines: ['LuckyLad'],
          stats: ['An extra draw at LuckyLad'],
        }
      : type === 'ascension_points'
        ? {
            title: 'Ascension Points',
            iconSrc: ASCENSION_POINTS_ICON_SRC,
            iconColor: ASCENSION_POINTS_COLOR,
            lines: ['Premium currency'],
            stats: ['Account-wide, not per-character'],
          }
        : type === 'gold'
          ? {
              title: 'Gold',
              icon: '💰',
              iconColor: GOLD_COLOR,
              stats: ['Currency'],
            }
          : type === 'comet_box'
            ? buildCometBoxTooltip()
            : type === 'vip_token'
              ? buildVipTokenTooltip()
              : type === 'comet'
                ? buildCometTooltip()
                : type === 'fallen_star'
                  ? buildFallenStarTooltip()
                  : type === 'comet_scroll'
                    ? buildCometScrollTooltip()
                    : buildFallenStarScrollTooltip()

  if (amount && amount > 1) {
    return { ...base, stats: [...(base.stats ?? []), `Amount: ${amount}`] }
  }

  return base
}
