import { useMemo, type CSSProperties } from 'react'
import { buildSparkleField } from './backgroundSparkleFieldData'
import { EVENT_EMBER_HEX } from './eventEmberBorderData'
import type { EventEmberColor } from './useEventEmberColor'

// Character-screen background sparkle (2026-09-06, requested by the user —
// "I want to see the background of player character screens sparkling with
// embers, colour depending on their PvP badge"). Reuses the app's existing
// per-badge color lookup (EVENT_EMBER_HEX's `champion`/`championWuxia`
// entries — see TopHunterBadge.tsx) rather than inventing a parallel palette,
// so the badge chip, its border-ember, and this background all agree on
// exactly one color per class' title.
//
// Sibling in spirit to tierEffects.tsx's TierEmberEffect and
// eventEmberBorder.tsx's EventEmberBorder, but scattered across the whole
// area and twinkling in place (see backgroundSparkleFieldData.ts) instead of
// bursting from a center point or a border ring. Meant to sit as an
// absolutely-positioned layer *behind* real content, inside a host that's
// already `position: relative` and clips its own overflow (AscensionCard's
// `.ascension-card-inner` chamfer does both once `sparkleColor` is passed) —
// unlike EventEmberBorder, this is meant to stay contained within the card,
// not spill past its edges, so no sibling-wrapper workaround is needed here.
export function BackgroundSparkleField({ color, seed = 7, count = 28 }: { color: EventEmberColor | null; seed?: number; count?: number }) {
  const sparkles = useMemo(() => buildSparkleField(count, seed), [count, seed])

  if (!color) {
    return null
  }

  const hex = EVENT_EMBER_HEX[color]

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {sparkles.map((sparkle, i) => {
        const style: CSSProperties & { '--sparkle-peak': number } = {
          left: `${sparkle.leftPct}%`,
          top: `${sparkle.topPct}%`,
          width: `${sparkle.size}px`,
          height: `${sparkle.size}px`,
          backgroundColor: hex,
          boxShadow: `0 0 ${sparkle.size + 3}px ${Math.max(1, sparkle.size - 1)}px ${hex}cc`,
          animationDelay: sparkle.delay,
          animationDuration: sparkle.duration,
          '--sparkle-peak': sparkle.peakOpacity,
        }
        return <span key={i} className="effect-sparkle-twinkle absolute rounded-full" style={style} />
      })}
    </div>
  )
}
