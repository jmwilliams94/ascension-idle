// Shared contract for every FxLayer effect (lightning.ts, comet.ts,
// ripple.ts) -- deliberately not a component or hook, since FxLayer runs
// these entirely inside its own requestAnimationFrame loop, outside React's
// render cycle, for the same reason a canvas particle system always is: a
// React re-render per frame per live effect would be far more expensive than
// this plain-object update/draw pair.
export interface FxEffect {
  // Advances the effect by `dt` seconds. Returns true once the effect is
  // finished and should be removed -- FxLayer drops it immediately after,
  // without a final draw() call, so update() should treat "finished" as "no
  // longer visible" (typically because its own alpha/progress has already
  // reached its end state on this same call).
  update(dt: number): boolean
  // width/height are the canvas's own CSS-pixel size (not the backing-store
  // pixel size -- FxLayer's resize handler already applies a devicePixelRatio
  // transform to the context, so effects should draw in plain CSS-pixel
  // coordinates and never touch ctx.canvas.width/height directly).
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void
}

export interface FxEffectOptions {
  // Target point in CSS pixels. Defaults to a randomized/centered point (see
  // each effect factory) when omitted -- most test-button call sites don't
  // pass one.
  x?: number
  y?: number
  // Confines this one effect's drawing to a rectangle in the same viewport
  // CSS-pixel space as x/y (e.g. a UI element's own getBoundingClientRect())
  // instead of the full page -- FxLayer clips its canvas context to this rect
  // for just this effect's draw() call, so nothing it paints (bolt, branches,
  // the full-canvas flash wash) escapes past the given container's edges.
  // Omitted (the default) draws across the whole full-screen canvas like
  // every existing caller.
  clip?: { x: number; y: number; width: number; height: number }
}
