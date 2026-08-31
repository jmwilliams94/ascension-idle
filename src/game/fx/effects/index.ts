import { createLightning } from './lightning'
import { createComet } from './comet'
import { createRipple } from './ripple'
import { createFlashStreak, createFlashStreakPurple, createFlashStreakShootingStar, createFlashStreakCrater } from './meteorFlash'
import type { FxEffect, FxEffectOptions } from './types'
import type { FxKind } from '../useFxStore'

// Single dispatch point from a FxKind string (what useFxStore's queue
// carries) to the actual effect factory -- FxLayer.tsx is the only caller,
// on every queued request it drains each frame.
export function createEffect(kind: FxKind, width: number, height: number, seed: number, options?: FxEffectOptions): FxEffect {
  switch (kind) {
    case 'lightning':
      return createLightning(width, height, seed, options)
    case 'comet':
      return createComet(width, height, seed, options)
    case 'ripple':
      return createRipple(width, height, seed, options)
    case 'flash-streak':
      return createFlashStreak(width, height, seed, options)
    case 'flash-streak-purple':
      return createFlashStreakPurple(width, height, seed, options)
    case 'flash-streak-shooting-star':
      return createFlashStreakShootingStar(width, height, seed, options)
    case 'flash-streak-crater':
      return createFlashStreakCrater(width, height, seed, options)
    default:
      return createRipple(width, height, seed, options)
  }
}
