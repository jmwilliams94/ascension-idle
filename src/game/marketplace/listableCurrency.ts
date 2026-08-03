import { FALLEN_STAR_COLOR, FALLEN_STAR_ICON_SRC, MATERIAL_COLOR, COMET_ICON_SRC } from '../items/forgeCosts'
import type { ListableCurrencyType } from './useMarketplaceStore'

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
      return { icon: '📜', qualityColor: MATERIAL_COLOR }
    case 'fallen_star_scroll':
      return { icon: '📜', qualityColor: FALLEN_STAR_COLOR }
  }
}
