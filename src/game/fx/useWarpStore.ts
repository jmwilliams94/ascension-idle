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
  prewarmCapture: () => void
  clear: (id: number) => void
}

let nextId = 0

// A capture kicked off ahead of the actual trigger -- see prewarmCapture
// below. Module-level (not store state) since it's write-only plumbing
// nothing needs to react to.
let pendingCapture: Promise<HTMLCanvasElement> | null = null
let pendingCaptureAt = 0
// If triggerWarp() is called long after the prewarm started, the page has
// likely changed since -- fall back to a fresh capture rather than show a
// stale one.
const PREWARM_MAX_AGE_MS = 3000

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
  // Starts the (slow, ~hundreds of ms to ~1s depending on page complexity)
  // screen capture early, before the actual trigger -- e.g. on a button's
  // pointerdown rather than its click, or (once wired to a real gameplay
  // trigger) the moment an upgrade attempt is sent to the server rather
  // than when its result comes back. triggerWarp() below reuses whatever
  // this produces instead of starting a fresh capture, so the effect can
  // start visibly the instant triggerWarp() fires instead of waiting out
  // the capture at that point -- the capture cost doesn't go away, it just
  // moves earlier, hidden behind whatever latency already exists between
  // the prewarm moment and the actual trigger (a mousedown-to-click gap for
  // a manual test button; a real network round-trip for a real gameplay
  // success/fail result). Safe to call speculatively even if nothing ends
  // up firing -- an unused prewarmed capture is just quietly discarded.
  prewarmCapture: () => {
    pendingCapture = captureScreen()
    pendingCaptureAt = performance.now()
    // Swallow here so an unused/failed prewarm never surfaces as an
    // unhandled rejection -- triggerWarp has its own catch for when (if)
    // this capture actually gets used.
    pendingCapture.catch(() => {})
  },
  triggerWarp: (x, y) => {
    nextId += 1
    const id = nextId
    const targetX = x ?? window.innerWidth / 2
    const targetY = y ?? window.innerHeight / 2

    const prewarmIsFresh = pendingCapture !== null && performance.now() - pendingCaptureAt < PREWARM_MAX_AGE_MS
    const capture = prewarmIsFresh ? pendingCapture! : captureScreen()
    pendingCapture = null

    capture
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
