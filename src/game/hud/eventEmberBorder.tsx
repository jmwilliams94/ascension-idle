import { useMemo, type CSSProperties } from 'react'
import { buildBorderEmbers, EVENT_EMBER_HEX } from './eventEmberBorderData'
import type { EventEmberColor } from './useEventEmberColor'

// Idling nav button border embers — a sibling effect to tierEffects.tsx's
// TierEmberEffect, but anchored around the element's own border (percentage
// left/top on an ellipse inscribed just inside the box, so it hugs a circle
// or a rounded-rect equally well) instead of bursting outward from a center
// point, and travels only a few px further out rather than TierEmberEffect's
// full-tile radius. Uses its own .effect-ember-border-emit CSS keyframe (see
// index.css) — holds each ember at its border anchor through its fade-in,
// then drifts it out to --ember-dx/--ember-dy, so it visibly emits from the
// border rather than appearing already partway through its travel the way
// reusing .effect-ember-radiate's timing would. See eventEmberBorderData.ts
// for the layout math and the eventBorderTintStyle helper (the button's own
// colored outline ring, a separate but related effect).

interface BorderEmberStyle extends CSSProperties {
  '--ember-dx': string
  '--ember-dy': string
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
        return <span key={i} className="effect-ember-border-emit pointer-events-none absolute rounded-full" style={style} />
      })}
    </>
  )
}
