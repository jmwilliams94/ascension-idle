import { useMemo, type CSSProperties } from 'react'
import { mulberry32 } from '../items/tierEffectsData'
import type { EventEmberColor } from './useEventEmberColor'

// Idling nav button border embers — a sibling effect to tierEffects.tsx's
// TierEmberEffect, but anchored around the element's own border (percentage
// left/top on an ellipse inscribed just inside the box, so it hugs a circle
// or a rounded-rect equally well) instead of bursting outward from a center
// point, and travels only a few px further out rather than TierEmberEffect's
// full-tile radius. Reuses the same .effect-ember-radiate CSS keyframe (see
// index.css) since the "fade in, drift by --ember-dx/--ember-dy, fade out"
// shape is identical, just with a different starting anchor and a much
// shorter travel distance.

const EVENT_EMBER_HEX: Record<EventEmberColor, string> = {
  boss: '#EF4444', // World Boss fight live
  buffActive: '#34D399', // Gold Donation buff triggered and live
  collecting: '#D4AF37', // Gold Donation pool open, buff not triggered yet
}

interface BorderEmberStyle extends CSSProperties {
  '--ember-dx': string
  '--ember-dy': string
}

interface BorderEmberConfig {
  leftPct: number
  topPct: number
  size: number
  delay: string
  duration: string
  dx: string
  dy: string
}

function buildBorderEmbers(count: number, seed: number): BorderEmberConfig[] {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, () => {
    const angle = rand() * Math.PI * 2
    // Anchor radius (46% of width/height) sits just inside the element's own
    // border on all sides, whether that border is a circle or a rounded-rect.
    const leftPct = 50 + Math.cos(angle) * 46
    const topPct = 50 + Math.sin(angle) * 46
    // Short outward travel only — "coming out from the border, not that far
    // outward" per the confirmed design, unlike TierEmberEffect's full burst.
    const distance = 3 + rand() * 5
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

// Renders nothing when `color` is null so callers can mount this
// unconditionally, same convention as TierEmberEffect's count<=0 guard.
// Parent must be `position: relative` (and not clip overflow) for the
// embers to anchor correctly.
export function EventEmberBorder({ color, seed = 1, count = 12 }: { color: EventEmberColor | null; seed?: number; count?: number }) {
  const embers = useMemo(() => buildBorderEmbers(count, seed), [count, seed])

  if (!color) {
    return null
  }

  const hex = EVENT_EMBER_HEX[color]

  return (
    <>
      {embers.map((ember, i) => {
        const style: BorderEmberStyle = {
          left: `${ember.leftPct}%`,
          top: `${ember.topPct}%`,
          width: `${ember.size}px`,
          height: `${ember.size}px`,
          backgroundColor: hex,
          boxShadow: `0 0 ${ember.size + 3}px ${Math.max(1, ember.size - 1)}px ${hex}cc`,
          animationDelay: ember.delay,
          animationDuration: ember.duration,
          '--ember-dx': ember.dx,
          '--ember-dy': ember.dy,
        }
        return <span key={i} className="effect-ember-radiate pointer-events-none absolute rounded-full" style={style} />
      })}
    </>
  )
}
