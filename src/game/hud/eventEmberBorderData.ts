import type { CSSProperties } from 'react'
import { mulberry32 } from '../items/tierEffectsData'
import type { EventEmberColor } from './useEventEmberColor'

// Data/logic half of the Idling nav-button border-ember effect — split from
// eventEmberBorder.tsx (which holds the actual EventEmberBorder component)
// because a file mixing component and non-component exports breaks React
// Fast Refresh, same reason tierEffects.tsx/tierEffectsData.ts are split.

export const EVENT_EMBER_HEX: Record<EventEmberColor, string> = {
  boss: '#EF4444', // World Boss fight live
  buffActive: '#34D399', // Gold Donation buff triggered and live
  collecting: '#D4AF37', // Gold Donation pool open, buff not triggered yet
  luckyFree: '#FBBF24', // LuckyLad free 4h ticket ready — brighter than `collecting`'s gold so the two read as distinct
}

// A slight colored ring around the button itself, on top of the floating
// embers, so the event state still reads even at a glance/small size
// (2026-08-16, requested by the user). Uses `outline` rather than `border`/
// `box-shadow` — both of those are already fully owned by .btn-gold/
// .btn-gold-active (see index.css), and outline composes independently
// without an inline style fighting that class's own box-shadow glow.
// `outline-offset` keeps it just outside the button, so it doesn't compete
// with .btn-gold's own edge for the same pixel row.
export function eventBorderTintStyle(color: EventEmberColor | null): CSSProperties {
  if (!color) {
    return {}
  }
  return { outline: `1.5px solid ${EVENT_EMBER_HEX[color]}99`, outlineOffset: '1px' }
}

export interface BorderEmberConfig {
  leftPct: number
  topPct: number
  size: number
  delay: string
  duration: string
  dx: string
  dy: string
}

export function buildBorderEmbers(count: number, seed: number): BorderEmberConfig[] {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, () => {
    const angle = rand() * Math.PI * 2
    // Anchor radius (56% of width/height) sits just OUTSIDE the element's own
    // border on all sides, whether that border is a circle or a rounded-rect
    // — moved out from an original 46% (2026-08-16, reported by the user:
    // embers anchored just inside the border were unreadable against
    // .btn-gold-active's own bright fill once a tab is selected). Anchoring
    // outside means the embers never sit on top of the button's own
    // background, so they stay visible in both the idle and active states.
    const leftPct = 50 + Math.cos(angle) * 56
    const topPct = 50 + Math.sin(angle) * 56
    // Short further outward travel — "coming out from the border, not that
    // far outward" per the confirmed design, unlike TierEmberEffect's full
    // burst — the anchor above already does the "at the border" part.
    // (2026-08-16: scaled 1.5x from an original 2-6px range, requested by
    // the user once a second button — CombatPage's Events sub-tab — started
    // using this effect too.)
    const distance = 3 + rand() * 6
    return {
      leftPct,
      topPct,
      size: 2 + Math.round(rand()),
      delay: `${(rand() * 2.2).toFixed(2)}s`,
      duration: `${(1.4 + rand() * 0.8).toFixed(2)}s`,
      dx: `${(Math.cos(angle) * distance).toFixed(1)}px`,
      dy: `${(Math.sin(angle) * distance).toFixed(1)}px`,
    }
  })
}
