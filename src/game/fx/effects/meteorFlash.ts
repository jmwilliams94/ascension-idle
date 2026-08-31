import { mulberry32 } from '../../items/tierEffectsData'
import type { FxEffect, FxEffectOptions } from './types'

// Eight lightweight flash sketches for the "bright light flickers across/
// into the sky and is gone" beat (2026-08-31, requested by the user --
// reference: Warcraft 3 Reign of Chaos' golem-drop flash). Distinct from
// comet.ts's full comet-impact+WebGL-warp combo -- these are plain 2D
// canvas, no useWarpStore dependency, meant to be cheap enough to fire on
// something as frequent as a material landing in the inventory after a
// kill. Preview-only via FxTestPanel for now, same as every other
// effects/*.ts factory -- none of these are wired to a real gameplay
// trigger yet; pick a favorite and it gets wired up.

const HOT_CORE = '#ffffff'
const WARM_WHITE = '#fff4d6'
const GOLD = '#ffcf7a'
const COOL_RIM = '#cfe8ff'

function screenWash(ctx: CanvasRenderingContext2D, width: number, height: number, color: string, alpha: number) {
  if (alpha <= 0) {
    return
  }
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
}

function radialGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: string, alpha: number) {
  if (alpha <= 0 || radius <= 0) {
    return
  }
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
  glow.addColorStop(0, color)
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function targetPoint(width: number, height: number, rand: () => number, options?: FxEffectOptions) {
  return {
    x: options?.x ?? width * (0.35 + rand() * 0.3),
    y: options?.y ?? height * (0.35 + rand() * 0.3),
  }
}

// 1. A single clean bright pulse -- attack, brief hold, decay. The baseline
// "something flashed" beat every other variant here riffs on.
export function createFlashBloom(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const { x, y } = targetPoint(width, height, rand, options)
  const RISE_MS = 70
  const HOLD_MS = 40
  const FADE_MS = 260
  const TOTAL_MS = RISE_MS + HOLD_MS + FADE_MS
  let elapsed = 0
  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, w, h) {
      let alpha: number
      if (elapsed < RISE_MS) {
        alpha = elapsed / RISE_MS
      } else if (elapsed < RISE_MS + HOLD_MS) {
        alpha = 1
      } else {
        alpha = Math.max(0, 1 - (elapsed - RISE_MS - HOLD_MS) / FADE_MS)
      }
      screenWash(ctx, w, h, WARM_WHITE, alpha * 0.1)
      radialGlow(ctx, x, y, Math.max(w, h) * 0.4, HOT_CORE, alpha)
    },
  }
}

// 2. Several quick uneven strobes -- the "flickering as it passes overhead"
// read, rather than one smooth pulse.
export function createFlashStrobe(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const { x, y } = targetPoint(width, height, rand, options)
  const pulses = [
    { start: 0, dur: 50, peak: 1 },
    { start: 90, dur: 40, peak: 0.65 },
    { start: 170, dur: 60, peak: 1 },
    { start: 270, dur: 100, peak: 0.5 },
  ]
  const TOTAL_MS = 270 + 100
  let elapsed = 0
  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, w, h) {
      let alpha = 0
      for (const p of pulses) {
        if (elapsed >= p.start && elapsed < p.start + p.dur) {
          const t = (elapsed - p.start) / p.dur
          alpha = Math.max(alpha, Math.sin(t * Math.PI) * p.peak)
        }
      }
      if (alpha <= 0) {
        return
      }
      screenWash(ctx, w, h, WARM_WHITE, alpha * 0.15)
      radialGlow(ctx, x, y, Math.max(w, h) * 0.4, HOT_CORE, alpha)
    },
  }
}

// 3. A vertical beam reveals itself top-down, then flashes bright at its
// base -- the golem-drop "light column from the sky" read.
export function createFlashColumn(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const { x, y } = targetPoint(width, height, rand, options)
  const DESCEND_MS = 160
  const FLASH_MS = 90
  const FADE_MS = 280
  const TOTAL_MS = DESCEND_MS + FLASH_MS + FADE_MS
  let elapsed = 0
  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, w, h) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      if (elapsed < DESCEND_MS) {
        const t = elapsed / DESCEND_MS
        const beamBottom = Math.max(1, y * t)
        const grad = ctx.createLinearGradient(x, 0, x, beamBottom)
        grad.addColorStop(0, 'transparent')
        grad.addColorStop(1, WARM_WHITE)
        ctx.globalAlpha = 0.8
        ctx.fillStyle = grad
        ctx.fillRect(x - 10, 0, 20, beamBottom)
        ctx.restore()
        return
      }
      const impactElapsed = elapsed - DESCEND_MS
      let alpha: number
      if (impactElapsed < FLASH_MS) {
        alpha = impactElapsed / FLASH_MS
      } else {
        alpha = Math.max(0, 1 - (impactElapsed - FLASH_MS) / FADE_MS)
      }
      ctx.restore()
      screenWash(ctx, w, h, GOLD, alpha * 0.1)
      radialGlow(ctx, x, y, Math.max(w, h) * 0.35, HOT_CORE, alpha)
    },
  }
}

// 4. White-hot core with a slightly delayed cool-blue rim -- reads as a
// physically hot object (a burning meteor) rather than a flat white flash.
export function createFlashChromatic(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const { x, y } = targetPoint(width, height, rand, options)
  const CORE_RISE = 60
  const CORE_FADE = 300
  const RIM_DELAY = 40
  const RIM_FADE = 380
  const TOTAL_MS = Math.max(CORE_RISE + CORE_FADE, RIM_DELAY + RIM_FADE)
  let elapsed = 0
  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, w, h) {
      const coreAlpha = elapsed < CORE_RISE ? elapsed / CORE_RISE : Math.max(0, 1 - (elapsed - CORE_RISE) / CORE_FADE)
      radialGlow(ctx, x, y, Math.max(w, h) * 0.22, HOT_CORE, coreAlpha)

      if (elapsed > RIM_DELAY) {
        const rimElapsed = elapsed - RIM_DELAY
        const rimT = Math.min(1, rimElapsed / RIM_FADE)
        const rimAlpha = Math.max(0, 1 - rimT) * 0.6
        radialGlow(ctx, x, y, Math.max(w, h) * (0.3 + 0.25 * rimT), COOL_RIM, rimAlpha)
      }
    },
  }
}

// 5. Two pulses -- a small warning flash, a beat of dark, then a bigger
// brighter one. A camera-flash-bouncing-twice read.
export function createFlashDoublePulse(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const { x, y } = targetPoint(width, height, rand, options)
  const pulses = [
    { start: 0, rise: 50, fade: 90, peak: 0.65 },
    { start: 190, rise: 60, fade: 240, peak: 1 },
  ]
  const TOTAL_MS = 190 + 60 + 240
  let elapsed = 0
  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, w, h) {
      let alpha = 0
      for (const p of pulses) {
        const local = elapsed - p.start
        if (local < 0) {
          continue
        }
        if (local < p.rise) {
          alpha = Math.max(alpha, (local / p.rise) * p.peak)
        } else if (local < p.rise + p.fade) {
          alpha = Math.max(alpha, Math.max(0, 1 - (local - p.rise) / p.fade) * p.peak)
        }
      }
      if (alpha <= 0) {
        return
      }
      screenWash(ctx, w, h, WARM_WHITE, alpha * 0.12)
      radialGlow(ctx, x, y, Math.max(w, h) * 0.32, HOT_CORE, alpha)
    },
  }
}

// 6. Bright core flash plus a thin expanding ring -- a shockwave read
// without the WebGL screen-warp comet.ts/ripple.ts use.
export function createFlashRingBurst(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const { x, y } = targetPoint(width, height, rand, options)
  const FLASH_MS = 80
  const CORE_FADE_MS = 220
  const RING_MS = 380
  const TOTAL_MS = Math.max(FLASH_MS + CORE_FADE_MS, RING_MS)
  let elapsed = 0
  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, w, h) {
      const coreAlpha = elapsed < FLASH_MS ? elapsed / FLASH_MS : Math.max(0, 1 - (elapsed - FLASH_MS) / CORE_FADE_MS)
      radialGlow(ctx, x, y, Math.max(w, h) * 0.2, HOT_CORE, coreAlpha)

      const ringT = Math.min(1, elapsed / RING_MS)
      const ringAlpha = Math.max(0, 1 - ringT) * 0.9
      if (ringAlpha > 0) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = ringAlpha
        ctx.strokeStyle = GOLD
        ctx.lineWidth = 6 * (1 - ringT) + 1
        ctx.beginPath()
        ctx.arc(x, y, Math.max(w, h) * 0.05 + ringT * Math.max(w, h) * 0.3, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    },
  }
}

// 7. A short bright streak sweeps in from off-screen and ends in a burst --
// the "meteor passing overhead" read, lighter-weight than comet.ts's full
// trail-of-circles version.
export function createFlashStreak(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const { x: targetX, y: targetY } = targetPoint(width, height, rand, options)
  const fromLeft = rand() > 0.5
  const startX = fromLeft ? -80 : width + 80
  const startY = -40
  const FLIGHT_MS = 180
  const BURST_MS = 260
  const TOTAL_MS = FLIGHT_MS + BURST_MS
  let elapsed = 0
  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, w, h) {
      if (elapsed < FLIGHT_MS) {
        const t = elapsed / FLIGHT_MS
        const cx = startX + (targetX - startX) * t
        const cy = startY + (targetY - startY) * t
        const tailT = Math.max(0, t - 0.18)
        const tailX = startX + (targetX - startX) * tailT
        const tailY = startY + (targetY - startY) * tailT
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.9
        const grad = ctx.createLinearGradient(tailX, tailY, cx, cy)
        grad.addColorStop(0, 'transparent')
        grad.addColorStop(1, WARM_WHITE)
        ctx.strokeStyle = grad
        ctx.lineWidth = 5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(tailX, tailY)
        ctx.lineTo(cx, cy)
        ctx.stroke()
        ctx.restore()
        return
      }
      const burstElapsed = elapsed - FLIGHT_MS
      const alpha = Math.max(0, 1 - burstElapsed / BURST_MS)
      radialGlow(ctx, targetX, targetY, Math.max(w, h) * 0.3, HOT_CORE, alpha)
    },
  }
}

// 8. Irregular seeded flicker built from a handful of random keyframes,
// rather than a smooth curve -- an unstable/faulty-light read.
export function createFlashFlicker(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const { x, y } = targetPoint(width, height, rand, options)
  const TOTAL_MS = 480
  const keyframeCount = 6
  const keyframes = Array.from({ length: keyframeCount }, (_, i) => ({
    t: (i / (keyframeCount - 1)) * TOTAL_MS,
    v: i === 0 || i === keyframeCount - 1 ? 0 : 0.3 + rand() * 0.7,
  }))
  let elapsed = 0

  function sample(ms: number): number {
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const a = keyframes[i]
      const b = keyframes[i + 1]
      if (ms >= a.t && ms <= b.t) {
        const localT = (ms - a.t) / (b.t - a.t)
        return a.v + (b.v - a.v) * localT
      }
    }
    return 0
  }

  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, w, h) {
      const alpha = sample(elapsed)
      if (alpha <= 0) {
        return
      }
      screenWash(ctx, w, h, WARM_WHITE, alpha * 0.14)
      radialGlow(ctx, x, y, Math.max(w, h) * 0.3, HOT_CORE, alpha)
    },
  }
}
