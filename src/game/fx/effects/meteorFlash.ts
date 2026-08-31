import { mulberry32 } from '../../items/tierEffectsData'
import type { FxEffect, FxEffectOptions } from './types'

// Flash-streak family (2026-08-31, requested by the user -- reference:
// Warcraft 3 Reign of Chaos' golem-drop flash, and a shooting star). The
// original 8-variant "meteor flash" sketch set (bloom/strobe/column/
// chromatic/double-pulse/ring/flicker) was replaced with this narrower set
// after user feedback picked Flash Streak as the only one that read as
// polished rather than cheap -- everything here builds on that shape
// instead of starting over. Plain 2D canvas, no useWarpStore dependency,
// meant to be cheap enough to fire on something as frequent as a material
// landing in the inventory after a kill. Preview-only via FxTestPanel for
// now -- none of these are wired to a real gameplay trigger yet.

const WARM_WHITE = '#fff4d6'
const HOT_CORE = '#ffffff'

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

// Baseline: a short bright streak sweeps in from off-screen and ends in a
// burst -- the one the user picked out of the original 8 as worth building
// on. Kept as-is for side-by-side comparison against the variants below.
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

const PURPLE_CORE = '#f7ecff'
const PURPLE_MID = '#c084fc'
const PURPLE_GLOW = '#7c3aed'

// A more polished, layered take on Flash Streak: violet instead of plain
// white, a soft-glow/mid-band/bright-core triple stroke (the same "halo
// then crisp core" layering lightning.ts uses) instead of one flat
// gradient line, a few glinting sparkle points riding the trail, and a
// thin expanding ring finishing the burst.
export function createFlashStreakPurple(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const { x: targetX, y: targetY } = targetPoint(width, height, rand, options)
  const fromLeft = rand() > 0.5
  const startX = fromLeft ? -80 : width + 80
  const startY = -40
  const FLIGHT_MS = 220
  const BURST_MS = 340
  const TOTAL_MS = FLIGHT_MS + BURST_MS
  let elapsed = 0

  const sparkles = Array.from({ length: 5 }, () => ({
    t: 0.15 + rand() * 0.7,
    side: rand() > 0.5 ? 1 : -1,
    offset: 4 + rand() * 8,
    phase: rand() * Math.PI * 2,
  }))

  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, w, h) {
      if (elapsed < FLIGHT_MS) {
        const t = elapsed / FLIGHT_MS
        const headX = startX + (targetX - startX) * t
        const headY = startY + (targetY - startY) * t
        const tailT = Math.max(0, t - 0.22)
        const tailX = startX + (targetX - startX) * tailT
        const tailY = startY + (targetY - startY) * tailT

        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const layers: [string, number, number][] = [
          [PURPLE_GLOW, 16, 0.35],
          [PURPLE_MID, 7, 0.75],
          [PURPLE_CORE, 3, 1],
        ]
        for (const [color, lineWidth, layerAlpha] of layers) {
          const grad = ctx.createLinearGradient(tailX, tailY, headX, headY)
          grad.addColorStop(0, 'transparent')
          grad.addColorStop(1, color)
          ctx.globalAlpha = layerAlpha
          ctx.strokeStyle = grad
          ctx.lineWidth = lineWidth
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(tailX, tailY)
          ctx.lineTo(headX, headY)
          ctx.stroke()
        }

        const dx = targetX - startX
        const dy = targetY - startY
        const len = Math.hypot(dx, dy) || 1
        for (const sparkle of sparkles) {
          if (sparkle.t > t) {
            continue
          }
          const sx = startX + dx * sparkle.t
          const sy = startY + dy * sparkle.t
          const nx = (-dy / len) * sparkle.side * sparkle.offset
          const ny = (dx / len) * sparkle.side * sparkle.offset
          const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(elapsed / 40 + sparkle.phase))
          radialGlow(ctx, sx + nx, sy + ny, 6, PURPLE_CORE, twinkle * 0.8)
        }
        ctx.restore()
        return
      }

      const burstElapsed = elapsed - FLIGHT_MS
      const alpha = Math.max(0, 1 - burstElapsed / BURST_MS)
      screenWash(ctx, w, h, PURPLE_GLOW, alpha * 0.08)
      radialGlow(ctx, targetX, targetY, Math.max(w, h) * 0.15, PURPLE_CORE, alpha)
      radialGlow(ctx, targetX, targetY, Math.max(w, h) * 0.34, PURPLE_GLOW, alpha * 0.6)

      const ringT = Math.min(1, burstElapsed / BURST_MS)
      const ringAlpha = Math.max(0, 1 - ringT) * 0.8
      if (ringAlpha > 0) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = ringAlpha
        ctx.strokeStyle = PURPLE_MID
        ctx.lineWidth = 4 * (1 - ringT) + 1
        ctx.beginPath()
        ctx.arc(targetX, targetY, Math.max(w, h) * 0.04 + ringT * Math.max(w, h) * 0.22, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    },
  }
}

const STAR_TAIL = '#1e1b4b'
const STAR_MID = '#f472b6'
const STAR_HEAD = '#fff0fa'

// Dark blue -> pink shooting star: a shallow bezier arc instead of a
// straight line, a twinkling sparkle trail, and a soft radiating
// twinkle-burst finish instead of a hard flash -- reads as "faded out",
// not "exploded", the way a real shooting star does.
export function createFlashStreakShootingStar(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const { x: targetX, y: targetY } = targetPoint(width, height, rand, options)
  const fromLeft = rand() > 0.5
  const startX = fromLeft ? -100 : width + 100
  const startY = -60
  const controlX = (startX + targetX) / 2
  const controlY = Math.min(startY, targetY) - height * 0.05 + rand() * height * 0.08

  const FLIGHT_MS = 260
  const FADE_MS = 260
  const TOTAL_MS = FLIGHT_MS + FADE_MS
  let elapsed = 0

  function bezier(t: number) {
    const mt = 1 - t
    return {
      x: mt * mt * startX + 2 * mt * t * controlX + t * t * targetX,
      y: mt * mt * startY + 2 * mt * t * controlY + t * t * targetY,
    }
  }

  const twinkles = Array.from({ length: 4 }, () => ({
    t: 0.1 + rand() * 0.75,
    phase: rand() * Math.PI * 2,
    size: 2 + rand() * 2,
  }))

  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, _w, _h) {
      if (elapsed < FLIGHT_MS) {
        const t = elapsed / FLIGHT_MS
        const head = bezier(t)
        const tailT = Math.max(0, t - 0.35)
        const tail = bezier(tailT)

        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y)
        grad.addColorStop(0, 'transparent')
        grad.addColorStop(0.55, STAR_TAIL)
        grad.addColorStop(1, STAR_HEAD)
        ctx.globalAlpha = 0.9
        ctx.strokeStyle = grad
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(tail.x, tail.y)
        const steps = 6
        for (let i = 1; i <= steps; i += 1) {
          const st = tailT + ((t - tailT) * i) / steps
          const p = bezier(st)
          ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()

        radialGlow(ctx, head.x, head.y, 10, STAR_HEAD, 0.9)
        radialGlow(ctx, head.x, head.y, 22, STAR_MID, 0.4)

        for (const tw of twinkles) {
          if (tw.t > t) {
            continue
          }
          const p = bezier(tw.t)
          const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(elapsed / 35 + tw.phase))
          radialGlow(ctx, p.x, p.y, tw.size * 3, STAR_HEAD, twinkle * 0.6)
        }
        ctx.restore()
        return
      }

      const fadeElapsed = elapsed - FLIGHT_MS
      const alpha = Math.max(0, 1 - fadeElapsed / FADE_MS)
      if (alpha <= 0) {
        return
      }
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = alpha
      ctx.strokeStyle = STAR_HEAD
      ctx.lineWidth = 1.5
      const spikeCount = 6
      const spikeLen = 14 * (1 + (1 - alpha))
      for (let i = 0; i < spikeCount; i += 1) {
        const angle = (i / spikeCount) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(targetX, targetY)
        ctx.lineTo(targetX + Math.cos(angle) * spikeLen, targetY + Math.sin(angle) * spikeLen)
        ctx.stroke()
      }
      ctx.restore()
      radialGlow(ctx, targetX, targetY, 26, STAR_MID, alpha * 0.5)
    },
  }
}

const METEOR_GLOW = '#ff8a3d'
const CRATER_DARK = '#241812'
const CRATER_RIM = '#c98a52'
const DUST_COLOR = '#b08a63'

// Flash-streak's flight, but it embeds instead of just flashing: an impact
// flare, jittered fracture cracks radiating from the point of impact, dust
// puffs drifting outward, and a dark crater ellipse (normal, not additive,
// compositing -- a crater is a dent, not a light source) that scales/fades
// in as the dust settles. Everything fades out together at the very end
// rather than popping off individually.
export function createFlashStreakCrater(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const { x: targetX, y: targetY } = targetPoint(width, height, rand, options)
  const fromLeft = rand() > 0.5
  const startX = fromLeft ? -80 : width + 80
  const startY = -50

  const FLIGHT_MS = 190
  const FLASH_MS = 90
  const SETTLE_MS = 420
  const HOLD_MS = 120
  const FADE_MS = 280
  const IMPACT_START = FLIGHT_MS
  const SETTLE_START = IMPACT_START + FLASH_MS
  const HOLD_START = SETTLE_START + SETTLE_MS
  const FADE_START = HOLD_START + HOLD_MS
  const TOTAL_MS = FADE_START + FADE_MS
  let elapsed = 0

  const crackCount = 6 + Math.floor(rand() * 3)
  const cracks = Array.from({ length: crackCount }, () => {
    const angle = rand() * Math.PI * 2
    const length = 18 + rand() * 26
    const midAngle = angle + (rand() - 0.5) * 0.6
    const midLen = length * (0.45 + rand() * 0.25)
    return {
      mid: { x: targetX + Math.cos(midAngle) * midLen, y: targetY + Math.sin(midAngle) * midLen },
      end: { x: targetX + Math.cos(angle) * length, y: targetY + Math.sin(angle) * length },
    }
  })

  const dustCount = 7 + Math.floor(rand() * 3)
  const dust = Array.from({ length: dustCount }, () => ({
    angle: rand() * Math.PI * 2,
    speed: 30 + rand() * 55,
    size: 5 + rand() * 7,
    delay: rand() * 60,
  }))

  const craterRx = 26 + rand() * 10
  const craterRy = craterRx * 0.42

  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, w, h) {
      if (elapsed < FLIGHT_MS) {
        const t = elapsed / FLIGHT_MS
        const headX = startX + (targetX - startX) * t
        const headY = startY + (targetY - startY) * t
        const tailT = Math.max(0, t - 0.2)
        const tailX = startX + (targetX - startX) * tailT
        const tailY = startY + (targetY - startY) * tailT
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const grad = ctx.createLinearGradient(tailX, tailY, headX, headY)
        grad.addColorStop(0, 'transparent')
        grad.addColorStop(0.6, METEOR_GLOW)
        grad.addColorStop(1, WARM_WHITE)
        ctx.globalAlpha = 0.95
        ctx.strokeStyle = grad
        ctx.lineWidth = 6
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(tailX, tailY)
        ctx.lineTo(headX, headY)
        ctx.stroke()
        ctx.restore()
        return
      }

      const overallAlpha = elapsed < FADE_START ? 1 : Math.max(0, 1 - (elapsed - FADE_START) / FADE_MS)
      if (overallAlpha <= 0) {
        return
      }

      if (elapsed < SETTLE_START) {
        const flashElapsed = elapsed - IMPACT_START
        const attack = FLASH_MS * 0.3
        const flashAlpha = flashElapsed < attack ? flashElapsed / attack : Math.max(0, 1 - (flashElapsed - attack) / (FLASH_MS - attack))
        radialGlow(ctx, targetX, targetY, Math.max(w, h) * 0.22, WARM_WHITE, flashAlpha * overallAlpha)
        screenWash(ctx, w, h, METEOR_GLOW, flashAlpha * 0.08 * overallAlpha)
      }

      const settleElapsed = Math.max(0, elapsed - SETTLE_START)
      for (const d of dust) {
        const localElapsed = settleElapsed - d.delay
        if (localElapsed < 0) {
          continue
        }
        const t = Math.min(1, localElapsed / (SETTLE_MS * 0.8))
        const dist = d.speed * t
        const dx = targetX + Math.cos(d.angle) * dist
        const dy = targetY + Math.sin(d.angle) * dist * 0.6 - t * 10
        radialGlow(ctx, dx, dy, d.size * (0.6 + t * 0.8), DUST_COLOR, (1 - t) * 0.5 * overallAlpha)
      }

      if (elapsed >= IMPACT_START) {
        const crackAlpha = Math.min(1, (elapsed - IMPACT_START) / (FLASH_MS + 80)) * overallAlpha
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = crackAlpha * 0.7
        ctx.strokeStyle = METEOR_GLOW
        ctx.lineWidth = 1.5
        for (const crack of cracks) {
          ctx.beginPath()
          ctx.moveTo(targetX, targetY)
          ctx.lineTo(crack.mid.x, crack.mid.y)
          ctx.lineTo(crack.end.x, crack.end.y)
          ctx.stroke()
        }
        ctx.restore()
      }

      const craterT = Math.min(1, settleElapsed / SETTLE_MS)
      if (craterT > 0) {
        const scale = 0.4 + craterT * 0.6
        ctx.save()
        ctx.globalAlpha = craterT * 0.85 * overallAlpha
        ctx.translate(targetX, targetY)
        ctx.scale(scale, scale)
        ctx.beginPath()
        ctx.ellipse(0, 0, craterRx, craterRy, 0, 0, Math.PI * 2)
        ctx.fillStyle = CRATER_DARK
        ctx.fill()
        ctx.restore()

        ctx.save()
        ctx.globalAlpha = craterT * 0.5 * overallAlpha
        ctx.translate(targetX, targetY)
        ctx.scale(scale, scale)
        ctx.beginPath()
        ctx.ellipse(0, 0, craterRx, craterRy, 0, 0, Math.PI * 2)
        ctx.strokeStyle = CRATER_RIM
        ctx.lineWidth = 2.5
        ctx.stroke()
        ctx.restore()
      }
    },
  }
}
