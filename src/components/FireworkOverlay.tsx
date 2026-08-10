import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useFireworkStore } from '../game/items/useFireworkStore'
import { mulberry32, seedFromId } from '../game/items/tierEffectsData'
import { EmberBurstPoint } from './EmberBurstPoint'

// Full-screen celebration overlay — fires from useFireworkStore, currently
// triggered by (1) Settings' Item Effects preview button and (2) gaining a
// gear socket (useForgeStore.ts, both the RNG armor proc and the guaranteed
// weapon unlock). Mounted unconditionally in GameShell like the other reveal
// overlays, renders nothing until fire() is called.
//
// Colors: every quality tier (Normal included, even though real gear tiles
// skip it — see tierEffectsData.ts's EMBER_DENSITY_BY_COLOR comment — a
// full-screen celebration should show the full ladder, not just the ones
// gear actually uses) plus the two rare-material colors (Comet/Composition
// Stones share one color, Fallen Star its own — both from forgeCosts.ts).
const FIREWORK_COLORS = [
  '#FFFFFF', // Normal
  '#4FC3F7', // Tempered
  '#2E5EAA', // Infused
  '#A855F7', // Radiant
  '#EF4444', // Ascended
  '#C8D0DC', // Comet / Composition Stones
  '#F0B87A', // Fallen Star
]

// Bumped from 9 to 15 bursts, closer together (0.18s -> 0.11s stagger), per
// the user's request for a busier/faster-paced show. DISPLAY_MS covers the
// last burst's own worst-case delay+duration so it isn't cut off mid-animation.
const BURST_COUNT = 15
const EMBERS_PER_BURST = 26
const BURST_RADIUS = 130
const BURST_STAGGER_S = 0.11
const DISPLAY_MS = 4200

interface BurstPoint {
  x: number
  y: number
  color: string
  delay: number
  seed: number
}

export default function FireworkOverlay() {
  const burstId = useFireworkStore((state) => state.burstId)
  const dismiss = useFireworkStore((state) => state.dismiss)

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
    // Deterministic per burstId (mulberry32, seeded off burstId itself) —
    // Math.random() during render trips the react-hooks/purity lint rule,
    // and a stable-per-burst layout is harmless here anyway (a fresh fire()
    // gets a fresh burstId, so no two bursts ever look identical).
    const rand = mulberry32(seedFromId(`firework-layout-${burstId}`))
    return Array.from({ length: BURST_COUNT }, (_, i) => ({
      x: 12 + rand() * 76,
      y: 14 + rand() * 62,
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
        <EmberBurstPoint
          key={i}
          x={point.x}
          y={point.y}
          color={point.color}
          delay={point.delay}
          seed={point.seed}
          radius={BURST_RADIUS}
          emberCount={EMBERS_PER_BURST}
        />
      ))}
    </div>,
    document.body,
  )
}
