import { mulberry32 } from '../../items/tierEffectsData'
import { useWarpStore } from '../useWarpStore'
import type { FxEffect, FxEffectOptions } from './types'

interface Point {
  x: number
  y: number
}

// Warm orange/gold -- shares the Fallen Star material color family
// (forgeCosts.ts's FALLEN_STAR_COLOR is '#F0B87A') rather than inventing an
// unrelated comet color, since "a comet falling from the sky" is already
// that item's own flavor in this game's fiction.
const COLOR = '#ffb457'
const FLIGHT_MS = 550
const IMPACT_MS = 500
const TOTAL_MS = FLIGHT_MS + IMPACT_MS
const TRAIL_LENGTH = 14
const RING_COUNT = 3

// Toggled directly on <html> rather than through React/Zustand state -- see
// index.css's .fx-screen-shake comment for why (one-shot fire-and-forget
// CSS animation, and the containing-block implications of transforming a
// fixed-position ancestor).
function triggerScreenShake() {
  const root = document.documentElement
  root.classList.remove('fx-screen-shake')
  // Force a reflow so re-adding the class restarts the animation even if a
  // previous shake's class hadn't finished clearing yet (rapid re-triggers).
  void root.offsetWidth
  root.classList.add('fx-screen-shake')
  window.setTimeout(() => root.classList.remove('fx-screen-shake'), 350)
}

function easeInQuad(t: number): number {
  return t * t
}

export function createComet(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const targetX = options?.x ?? width * (0.35 + rand() * 0.3)
  const targetY = options?.y ?? height * (0.4 + rand() * 0.25)
  const fromLeft = rand() > 0.5
  const startX = fromLeft ? -60 : width + 60
  const startY = -60

  let elapsed = 0
  let impactFired = false
  const trail: Point[] = []

  return {
    update(dt) {
      elapsed += dt * 1000
      if (elapsed < FLIGHT_MS) {
        const t = easeInQuad(elapsed / FLIGHT_MS)
        trail.unshift({ x: startX + (targetX - startX) * t, y: startY + (targetY - startY) * t })
        if (trail.length > TRAIL_LENGTH) {
          trail.pop()
        }
      } else if (!impactFired) {
        impactFired = true
        triggerScreenShake()
        // The actual screen-warp (see WarpLayer.tsx) -- captures the screen
        // and distorts it, layered underneath this effect's own glow rings
        // drawn below. Fired here rather than at flight-start so the
        // capture reflects the screen right as the comet lands, not 550ms
        // earlier -- the small async capture latency reads as a beat of
        // hitstop before the shockwave, which is an acceptable rough edge
        // for now rather than something worth a "prepare early" redesign.
        useWarpStore.getState().triggerWarp(targetX, targetY)
      }
      return elapsed >= TOTAL_MS
    },
    draw(ctx, drawWidth, drawHeight) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'

      if (elapsed < FLIGHT_MS) {
        for (let i = 0; i < trail.length; i += 1) {
          const point = trail[i]
          const t = 1 - i / trail.length
          const radius = 3 + t * 5
          // A radial gradient standing in for shadowBlur's glow -- shadowBlur
          // is a real per-pixel blur the browser recomputes every draw call,
          // expensive enough with ~14 of these per frame during flight that
          // it was a likely source of the FPS drop reported before the warp
          // shader even existed. A gradient is just a fill, no blur pass.
          ctx.globalAlpha = t * 0.8
          const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 2.5)
          glow.addColorStop(0, COLOR)
          glow.addColorStop(1, 'transparent')
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(point.x, point.y, radius * 2.5, 0, Math.PI * 2)
          ctx.fill()
        }
      } else {
        const impactT = (elapsed - FLIGHT_MS) / IMPACT_MS
        const maxRadius = Math.max(drawWidth, drawHeight) * 0.55

        for (let i = 0; i < RING_COUNT; i += 1) {
          const ringT = impactT - i * 0.12
          if (ringT <= 0 || ringT >= 1) {
            continue
          }
          // Same shadowBlur-avoidance as the trail above: a crisp core
          // stroke plus a wider, fainter one underneath fakes a soft glow
          // edge for a fraction of the cost.
          const ringRadius = ringT * maxRadius
          const baseAlpha = (1 - ringT) * 0.5
          ctx.globalAlpha = baseAlpha * 0.4
          ctx.strokeStyle = COLOR
          ctx.lineWidth = 9
          ctx.beginPath()
          ctx.arc(targetX, targetY, ringRadius, 0, Math.PI * 2)
          ctx.stroke()
          ctx.globalAlpha = baseAlpha
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(targetX, targetY, ringRadius, 0, Math.PI * 2)
          ctx.stroke()
        }

        const flashAlpha = Math.max(0, 1 - impactT * 4) * 0.35
        if (flashAlpha > 0) {
          ctx.globalAlpha = flashAlpha
          const gradient = ctx.createRadialGradient(targetX, targetY, 0, targetX, targetY, maxRadius * 1.1)
          gradient.addColorStop(0, COLOR)
          gradient.addColorStop(1, 'transparent')
          ctx.fillStyle = gradient
          ctx.fillRect(0, 0, drawWidth, drawHeight)
        }
      }
      ctx.restore()
    },
  }
}
