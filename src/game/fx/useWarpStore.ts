import { create } from 'zustand'
import { captureScreen } from './screenCapture'

export interface ActiveWarp {
  id: number
  canvas: HTMLCanvasElement
  x: number // CSS px, impact/origin point
  y: number // CSS px
  startedAt: number // performance.now() at the moment the capture resolved
}

interface WarpState {
  active: ActiveWarp | null
  triggerWarp: (x?: number, y?: number) => void
  clear: (id: number) => void
}

let nextId = 0

// Drives WarpLayer.tsx -- the WebGL counterpart to useFxStore.ts's 2D
// effects, for the one kind of effect a 2D canvas can't produce: actually
// displacing the real on-screen UI (see WarpLayer's own doc comment).
// Separate store from useFxStore because this one's trigger is async (it
// has to capture the screen first) where useFxStore's is synchronous --
// keeping them apart avoids a mixed sync/async contract on one store.
//
// Only one warp at a time by design (a second trigger's capture, once it
// resolves, simply replaces `active` and implicitly cancels whatever was
// mid-animation) -- stacking multiple simultaneous screen photos/shaders
// isn't a look worth supporting, and this is a rare, deliberate, one-shot
// effect (a comet impact, a big upgrade), not something that fires rapidly.
export const useWarpStore = create<WarpState>((set, get) => ({
  active: null,
  triggerWarp: (x, y) => {
    nextId += 1
    const id = nextId
    const targetX = x ?? window.innerWidth / 2
    const targetY = y ?? window.innerHeight / 2
    captureScreen()
      .then((canvas) => {
        set({ active: { id, canvas, x: targetX, y: targetY, startedAt: performance.now() } })
      })
      .catch(() => {
        // Capture failed (most likely a CORS-tainted image resource) --
        // fail silently. No warp this time rather than crashing the whole
        // FX pipeline over one cosmetic layer; see screenCapture.ts.
      })
  },
  clear: (id) => {
    if (get().active?.id === id) {
      set({ active: null })
    }
  },
}))
