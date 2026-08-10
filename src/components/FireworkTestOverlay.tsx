import { useEffect, useMemo, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useFireworkTestStore } from '../game/items/useFireworkTestStore'
import { buildConfettiEmbers, seedFromId } from '../game/items/tierEffectsData'

// Settings-only "preview" overlay (Item Effects section's Test button) — a
// full-screen scatter of the same confetti-style ember burst used by
// MoneyBagRevealModal/SalvageRevealToast (buildConfettiEmbers/
// .effect-ember-confetti), just fired from several random points across the
// whole viewport instead of one reveal card's center, and cycling through
// every established ember color at once rather than one reveal's own color.
// Dev/QA-facing only — mounted unconditionally in GameShell like the other
// reveal overlays, renders nothing until Settings' Test button calls
// useFireworkTestStore's fire().
//
// Colors: every quality tier (Normal included, even though real gear tiles
// skip it — see tierEffectsData.ts's EMBER_DENSITY_BY_COLOR comment — a
// firework preview should show the full ladder, not just the ones gear
// actually uses) plus the two rare-material colors (Comet/Composition Stones
// share one color, Fallen Star its own — both from forgeCosts.ts).
const FIREWORK_COLORS = [
  '#FFFFFF', // Normal
  '#4FC3F7', // Tempered
  '#2E5EAA', // Infused
  '#A855F7', // Radiant
  '#EF4444', // Ascended
  '#C8D0DC', // Comet / Composition Stones
  '#F0B87A', // Fallen Star
]

const BURST_COUNT = 9
const EMBERS_PER_BURST = 26
const BURST_RADIUS = 130
const BURST_STAGGER_S = 0.18
const DISPLAY_MS = 3400

interface BurstStyle extends CSSProperties {
  '--ember-dx': string
  '--ember-dy': string
  '--ember-fall': string
}

interface BurstPoint {
  x: number
  y: number
  color: string
  delay: number
  seed: number
}

function Burst({ x, y, color, delay, seed }: BurstPoint) {
  const embers = useMemo(() => buildConfettiEmbers(EMBERS_PER_BURST, seed, BURST_RADIUS), [seed])

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

export default function FireworkTestOverlay() {
  const burstId = useFireworkTestStore((state) => state.burstId)
  const dismiss = useFireworkTestStore((state) => state.dismiss)

  useEffect(() => {
    if (burstId === null) {
      return
    }
    const timeout = setTimeout(dismiss, DISPLAY_MS)
    return () => clearTimeout(timeout)
  }, [burstId, dismiss])

  const points = useMemo<BurstPoint[]>(() => {
    if (burstId === null) {
      return []
    }
    return Array.from({ length: BURST_COUNT }, (_, i) => ({
      x: 12 + Math.random() * 76,
      y: 14 + Math.random() * 62,
      color: FIREWORK_COLORS[i % FIREWORK_COLORS.length],
      delay: i * BURST_STAGGER_S,
      seed: seedFromId(`firework-${burstId}-${i}`),
    }))
  }, [burstId])

  if (burstId === null) {
    return null
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {points.map((point, i) => (
        <Burst key={i} {...point} />
      ))}
    </div>,
    document.body,
  )
}
