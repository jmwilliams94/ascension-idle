import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFxStore } from './useFxStore'
import { createEffect } from './effects'
import type { FxEffect } from './effects/types'

// Full-screen canvas overlay for one-shot procedural effects (lightning
// bolts, comet impacts, upgrade ripples -- see effects/*.ts). Mounted once
// in GameShell like FireworkOverlay/GainToastHost, portaled to document.body
// so it sits above every real page regardless of where it's rendered from.
// z-[47], deliberately below the app's z-50 modal scale (BankActionModal,
// SettingsModal, etc.) so an in-flight attack effect never renders on top
// of an open menu/popup -- it used to sit at z-[90], above every modal,
// letting lightning bolts bleed over whatever overlay was open (reported
// by the user). See WarpLayer.tsx's own comment for the paired z-[45].
//
// Canvas, not DOM/CSS, on purpose: tierEffects.tsx's ember system (dozens of
// absolutely-positioned <span>s animated by CSS keyframes) works well for
// "particles radiating from a fixed point," but organic non-repeating shapes
// like a jagged lightning bolt or a comet's arcing trail need per-frame
// procedural drawing that CSS interpolation can't give you. A single canvas
// is also far cheaper than one DOM node per particle once effects start
// layering (a comet's whole trail + impact rings is ~20 draw calls on one
// element, not ~20 separate elements).
//
// Effects live entirely inside this component's own requestAnimationFrame
// loop via plain FxEffect objects (update/draw, see effects/types.ts) held
// in a ref array -- never in React state -- so a live effect never causes a
// React re-render, and this component itself only re-renders if remounted.
//
// The loop only actually runs while there's something to draw -- it stops
// itself (no further requestAnimationFrame call) the moment `live` empties
// out, and a useFxStore subscription wakes it back up on the next trigger()
// call. An earlier version rescheduled unconditionally forever, running a
// full-screen clearRect at 60fps for this component's entire mounted
// lifetime (i.e. the whole time a player has the game open) even with zero
// active effects -- a real, continuous, always-on cost competing with
// combat/animation work for no reason, reported by the user as general FPS
// issues that predated any of the FX actually firing.
export default function FxLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return undefined
    }

    let width = window.innerWidth
    let height = window.innerHeight

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      // Every effect draws in plain CSS-pixel coordinates -- this transform
      // is what makes that correct on a high-DPI screen without each effect
      // having to know about devicePixelRatio itself.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // Pairs each live effect with the clip rect (if any) its own trigger()
    // request carried -- kept alongside the effect rather than inside it
    // since clipping is applied generically here in the loop, not something
    // any individual effect factory (lightning.ts, comet.ts, ...) needs to
    // know about.
    const live: { effect: FxEffect; clip?: { x: number; y: number; width: number; height: number } }[] = []
    let lastTime = performance.now()
    let raf = 0
    let running = false

    const tick = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05)
      lastTime = time

      const { queue } = useFxStore.getState()
      if (queue.length > 0) {
        useFxStore.setState({ queue: [] })
        for (const request of queue) {
          live.push({
            effect: createEffect(request.kind, width, height, request.id, request.options),
            clip: request.options?.clip,
          })
        }
      }

      ctx.clearRect(0, 0, width, height)
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const item = live[i]
        const finished = item.effect.update(dt)
        if (finished) {
          live.splice(i, 1)
          continue
        }
        if (item.clip) {
          ctx.save()
          ctx.beginPath()
          ctx.rect(item.clip.x, item.clip.y, item.clip.width, item.clip.height)
          ctx.clip()
          item.effect.draw(ctx, width, height)
          ctx.restore()
        } else {
          item.effect.draw(ctx, width, height)
        }
      }

      if (live.length > 0) {
        raf = requestAnimationFrame(tick)
      } else {
        running = false
      }
    }

    const ensureRunning = () => {
      if (running) {
        return
      }
      running = true
      lastTime = performance.now()
      raf = requestAnimationFrame(tick)
    }

    // Covers both a fresh trigger() arriving while idle (this fires
    // synchronously inside trigger()'s own set() call) and the loop already
    // running (a no-op there, since `running` is already true).
    const unsubscribe = useFxStore.subscribe((state) => {
      if (state.queue.length > 0) {
        ensureRunning()
      }
    })

    // Covers whatever's already queued (or mid-flight, on a HMR remount) at
    // mount time.
    if (useFxStore.getState().queue.length > 0) {
      ensureRunning()
    }

    return () => {
      cancelAnimationFrame(raf)
      unsubscribe()
      window.removeEventListener('resize', resize)
    }
  }, [])

  return createPortal(
    <canvas ref={canvasRef} data-fx-exclude="true" className="pointer-events-none fixed inset-0 z-[47]" />,
    document.body,
  )
}
