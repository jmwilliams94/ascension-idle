import { useMemo, type CSSProperties } from 'react'
import { buildConfettiEmbers } from '../game/items/tierEffectsData'

// Shared single-origin confetti-style ember burst — the same particle math/
// CSS animation MoneyBagRevealModal's own EmberBurst introduced
// (buildConfettiEmbers/.effect-ember-confetti), pulled out so FireworkOverlay
// (many scattered origins) and LevelUpBanner (a handful around one banner)
// can both reuse it instead of each keeping its own copy.
//
// Deliberately renders only the embers themselves, positioned at (x%, y%)
// within an `absolute` box — no sizing/pointer-events wrapper of its own.
// The caller supplies that (a `relative`/`absolute inset-0` container sized
// to whatever area the burst should be scattered across), same as
// MoneyBagRevealModal's existing `pointer-events-none absolute inset-0
// overflow-visible` wrapper.
interface BurstStyle extends CSSProperties {
  '--ember-dx': string
  '--ember-dy': string
  '--ember-fall': string
}

export interface EmberBurstPointProps {
  x: number
  y: number
  color: string
  seed: number
  delay?: number
  radius?: number
  emberCount?: number
}

export function EmberBurstPoint({ x, y, color, seed, delay = 0, radius = 90, emberCount = 24 }: EmberBurstPointProps) {
  const embers = useMemo(() => buildConfettiEmbers(emberCount, seed, radius), [emberCount, seed, radius])

  return (
    <div className="absolute" style={{ left: `${x}%`, top: `${y}%` }}>
      {embers.map((ember, i) => {
        const style: BurstStyle = {
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${ember.size + 2}px`,
          height: `${ember.size + 2}px`,
          backgroundColor: color,
          boxShadow: `0 0 ${ember.size + 5}px ${Math.max(1, ember.size)}px ${color}cc`,
          animationDelay: `${(delay + parseFloat(ember.delay)).toFixed(2)}s`,
          animationDuration: ember.duration,
          '--ember-dx': ember.dx,
          '--ember-dy': ember.dy,
          '--ember-fall': ember.fall,
        }
        return <span key={i} className="effect-ember-confetti absolute rounded-full" style={style} />
      })}
    </div>
  )
}
