import {
  FALLEN_STAR_COLOR,
  FALLEN_STAR_ICON_SRC,
  FALLEN_STAR_SCROLL_ICON_SRC,
  MATERIAL_COLOR,
  COMET_ICON_SRC,
  COMET_SCROLL_ICON_SRC,
} from '../items/forgeCosts'
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
// two wrappers exist alongside (not merged into) the functions above, which
// stay scoped to what a player can actually list for sale.
const ASCENSION_POINTS_COLOR = '#a855f7'

export function mailCurrencyLabel(type: MailCurrencyType): string {
  if (type === 'lottery_ticket') return 'Lottery Ticket'
  if (type === 'ascension_points') return 'Ascension Points'
  return listableCurrencyLabel(type)
}

export function mailCurrencyVisual(type: MailCurrencyType): ListableCurrencyVisual {
  if (type === 'lottery_ticket') return { icon: '🎫', qualityColor: MATERIAL_COLOR }
  if (type === 'ascension_points') return { icon: '🎖️', qualityColor: ASCENSION_POINTS_COLOR }
  return listableCurrencyVisual(type)
}
