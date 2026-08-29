import { mulberry32 } from '../../items/tierEffectsData'
import type { FxEffect, FxEffectOptions } from './types'

interface Point {
  x: number
  y: number
}

// Recursive midpoint displacement -- the standard procedural-lightning
// technique. Each recursion halves the displacement range, so the bolt
// looks jagged near its full length and smooths out toward each half's own
// endpoints, the same way a real lightning strike branches at large angles
// near its source and straightens out toward each tip.
function buildBolt(rand: () => number, start: Point, end: Point, displace: number, depth: number): Point[] {
  if (depth <= 0) {
    return [start, end]
  }
  const mid: Point = {
    x: (start.x + end.x) / 2 + (rand() - 0.5) * displace,
    y: (start.y + end.y) / 2 + (rand() - 0.5) * displace,
  }
  const first = buildBolt(rand, start, mid, displace / 2, depth - 1)
  const second = buildBolt(rand, mid, end, displace / 2, depth - 1)
  return [...first, ...second.slice(1)]
}

// Electric violet -- distinct from the amber/gold the rest of the game's
// chrome uses, so it reads as a combat/skill effect (Wuxia-flavored) rather
// than a UI accent. Not yet wired to any real class-specific palette.
const COLOR = '#b98bff'
const FLASH_MS = 90
const HOLD_MS = 90
const FADE_MS = 260
const TOTAL_MS = FLASH_MS + HOLD_MS + FADE_MS

export function createLightning(width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  const rand = mulberry32(seed)
  const targetX = options?.x ?? width * (0.3 + rand() * 0.4)
  const targetY = options?.y ?? height * (0.35 + rand() * 0.3)
  const start: Point = { x: targetX + (rand() - 0.5) * width * 0.3, y: -20 }
  const end: Point = { x: targetX, y: targetY }
  const path = buildBolt(rand, start, end, width * 0.18, 6)

  // A couple of short branches peeling off partway down the main bolt, each
  // its own (shallower) midpoint-displacement run so they don't just look
  // like scaled-down copies of the trunk.
  const branches = Array.from({ length: 2 + Math.floor(rand() * 2) }, () => {
    const t = 0.25 + rand() * 0.5
    const from = path[Math.floor(t * (path.length - 1))]
    const branchEnd: Point = { x: from.x + (rand() - 0.5) * width * 0.15, y: from.y + height * (0.08 + rand() * 0.12) }
    return buildBolt(rand, from, branchEnd, width * 0.05, 3)
  })

  let elapsed = 0

  function strokePath(ctx: CanvasRenderingContext2D, pts: Point[], alpha: number, lineWidth: number) {
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i += 1) {
      ctx.lineTo(pts[i].x, pts[i].y)
    }
    ctx.globalAlpha = alpha
    ctx.strokeStyle = COLOR
    ctx.lineWidth = lineWidth
    ctx.shadowColor = COLOR
    ctx.shadowBlur = 18
    ctx.stroke()
  }

  return {
    update(dt) {
      elapsed += dt * 1000
      return elapsed >= TOTAL_MS
    },
    draw(ctx, drawWidth, drawHeight) {
      let alpha: number
      if (elapsed < FLASH_MS) {
        alpha = elapsed / FLASH_MS
      } else if (elapsed < FLASH_MS + HOLD_MS) {
        alpha = 1
      } else {
        alpha = Math.max(0, 1 - (elapsed - FLASH_MS - HOLD_MS) / FADE_MS)
      }
      if (alpha <= 0) {
        return
      }

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'

      // Brief, faint full-screen wash on the initial strike -- the "the sky
      // just lit up" beat, separate from the bolt's own glow.
      if (elapsed < FLASH_MS + 40) {
        ctx.globalAlpha = Math.max(0, 1 - elapsed / (FLASH_MS + 40)) * 0.12
        ctx.fillStyle = COLOR
        ctx.fillRect(0, 0, drawWidth, drawHeight)
      }

      // Wide soft under-stroke first, then the crisp bright core on top --
      // gives the bolt a glowing halo instead of a flat line.
      strokePath(ctx, path, alpha * 0.6, 7)
      strokePath(ctx, path, alpha, 3)
      for (const branch of branches) {
        strokePath(ctx, branch, alpha * 0.7, 2)
      }
      ctx.restore()
    },
  }
}
