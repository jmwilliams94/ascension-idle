import type { FxEffect, FxEffectOptions } from './types'

// Amber -- matches the game's established gold/upgrade accent (.btn-gold,
// text-gradient-gold), so this reads as "an upgrade/success pulse" rather
// than a generic UI flourish.
const COLOR = '#fbbf24'
const RING_COUNT = 3
const RING_STAGGER_MS = 130
const RING_DURATION_MS = 700
const TOTAL_MS = RING_STAGGER_MS * (RING_COUNT - 1) + RING_DURATION_MS

// Staggered expanding rings from a center point (default: screen center, for
// a global "something big just happened" pulse -- e.g. an Ascend). Unlike
// lightning.ts/comet.ts this doesn't need a seed for randomized shape, but
// still takes one as its 3rd positional arg for a consistent factory
// signature across every FxKind (see effects/index.ts).
export function createRipple(width: number, height: number, _seed: number, options?: FxEffectOptions): FxEffect {
  const targetX = options?.x ?? width / 2
  const targetY = options?.y ?? height / 2
  const maxRadius = Math.max(width, height) * 0.75

  let elapsed = 0

  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < RING_COUNT; i += 1) {
        const ringElapsed = elapsed - i * RING_STAGGER_MS
        if (ringElapsed <= 0 || ringElapsed >= RING_DURATION_MS) {
          continue
        }
        const t = ringElapsed / RING_DURATION_MS
        ctx.globalAlpha = (1 - t) * 0.55
        ctx.strokeStyle = COLOR
        ctx.lineWidth = 4 * (1 - t * 0.5)
        ctx.shadowColor = COLOR
        ctx.shadowBlur = 16
        ctx.beginPath()
        ctx.arc(targetX, targetY, t * maxRadius, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    },
  }
}
