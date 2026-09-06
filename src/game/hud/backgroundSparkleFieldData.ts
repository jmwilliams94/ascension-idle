// Data/logic half of the character-screen background sparkle field — split
// from backgroundSparkleField.tsx (which holds the actual component) for the
// same Fast-Refresh reason tierEffects.tsx/tierEffectsData.ts and
// eventEmberBorder.tsx/eventEmberBorderData.ts are split.
//
// Unlike tierEffectsData's buildRadiateEmbers (particles launch from a
// tile's center outward) or eventEmberBorderData's buildBorderEmbers
// (particles anchor around a border ring), this scatters particles at fixed
// random positions across the whole area and twinkles them in place — a
// starfield, not a burst — since this is meant to read as an ambient
// background behind a character screen's content, not an emission effect
// tied to one edge or point.

import { mulberry32 } from '../items/tierEffectsData'

export interface SparkleConfig {
  leftPct: number
  topPct: number
  size: number
  delay: string
  duration: string
  peakOpacity: number
}

export function buildSparkleField(count: number, seed: number): SparkleConfig[] {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, () => ({
    // 4-96% keeps particles just inside the card's own chamfered corners
    // rather than sitting exactly on the clipped edge.
    leftPct: 4 + rand() * 92,
    topPct: 4 + rand() * 92,
    size: 1 + Math.round(rand() * 2),
    delay: `${(rand() * 3.5).toFixed(2)}s`,
    duration: `${(2.4 + rand() * 2).toFixed(2)}s`,
    peakOpacity: 0.5 + rand() * 0.4,
  }))
}
