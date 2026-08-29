import { useWarpStore } from '../useWarpStore'
import type { FxEffect, FxEffectOptions } from './types'

// Just triggers the screen-warp (see WarpLayer.tsx) at a center point
// (default: screen center, for a global "something big just happened"
// pulse -- e.g. an Ascend) and finishes immediately -- no 2D ring drawing of
// its own (2026-08-29, requested by the user: isolate the warp; this used
// to also draw staggered amber rings, see git history if that layered look
// is ever wanted back). Unlike lightning.ts/comet.ts this doesn't need a
// seed for randomized shape, but still takes one as its 3rd positional arg
// for a consistent factory signature across every FxKind (see
// effects/index.ts).
export function createRipple(width: number, height: number, _seed: number, options?: FxEffectOptions): FxEffect {
  const targetX = options?.x ?? width / 2
  const targetY = options?.y ?? height / 2

  useWarpStore.getState().triggerWarp(targetX, targetY)

  return {
    update() {
      return true
    },
    draw() {},
  }
}
