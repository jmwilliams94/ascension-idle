import { create } from 'zustand'
import type { FxEffectOptions } from './effects/types'

export type FxKind =
  | 'lightning'
  | 'comet'
  | 'ripple'
  | 'flash-streak'
  | 'flash-streak-purple'
  | 'flash-streak-shooting-star'
  | 'flash-streak-crater'

export interface FxRequest {
  id: number
  kind: FxKind
  options?: FxEffectOptions
}

interface FxState {
  queue: FxRequest[]
  trigger: (kind: FxKind, options?: FxEffectOptions) => void
}

let nextId = 0

// Drives FxLayer.tsx -- a full-screen canvas overlay for one-shot procedural
// effects (lightning bolts, comet impacts, upgrade ripples), the polished/
// organic counterpart to tierEffects.tsx's DOM/CSS ember system (canvas
// suits these better -- see FxLayer's own comment for why). `queue` is
// drained by FxLayer's own requestAnimationFrame loop via getState/setState,
// not by React re-rendering it, so calling trigger() never causes a React
// re-render anywhere -- any component/store can fire an effect and it's
// picked up on the next animation frame regardless of what else is mounted.
export const useFxStore = create<FxState>((set) => ({
  queue: [],
  trigger: (kind, options) => set((state) => ({ queue: [...state.queue, { id: nextId++, kind, options }] })),
}))
