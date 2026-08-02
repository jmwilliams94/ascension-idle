import { DRAGONBALL_COLOR, DRAGONBALL_ICON_SRC, MATERIAL_COLOR, METEOR_ICON_SRC } from '../items/forgeCosts'
import type { ListableCurrencyType } from './useMarketplaceStore'

// Small display helpers shared by MarketplaceListingSlot (the "List an Item"
// drop target) and MarketplacePanel's listing/mail tile rendering — kept
// here rather than duplicated in both, since the icon/color/label for each
// of the 4 listable currency types needs to stay consistent everywhere a
// currency-type listing or Mail entry renders.
export function listableCurrencyLabel(type: ListableCurrencyType): string {
  switch (type) {
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

export interface ListableCurrencyVisual {
  icon?: string
  iconSrc?: string
  qualityColor: string
}

export function listableCurrencyVisual(type: ListableCurrencyType): ListableCurrencyVisual {
  switch (type) {
    case 'meteor':
      return { iconSrc: METEOR_ICON_SRC, qualityColor: MATERIAL_COLOR }
    case 'dragonball':
      return { iconSrc: DRAGONBALL_ICON_SRC, qualityColor: DRAGONBALL_COLOR }
    case 'meteor_scroll':
      return { icon: '📜', qualityColor: MATERIAL_COLOR }
    case 'dragonball_scroll':
      return { icon: '📜', qualityColor: DRAGONBALL_COLOR }
  }
}
