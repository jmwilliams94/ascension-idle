import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFxStore } from './useFxStore'
import { createEffect } from './effects'
import type { FxEffect } from './effects/types'

// Full-screen canvas overlay for one-shot procedural effects (lightning
// bolts, comet impacts, upgrade ripples -- see effects/*.ts). Mounted once
// in GameShell like FireworkOverlay/GainToastHost, portaled to document.body
// so it sits above every real page regardless of where it's rendered from.
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
// New requests are drained from useFxStore's queue each frame via
// getState/setState rather than a subscription, since polling once per RAF
// tick is simpler than wiring a subscribe callback and costs nothing extra
// (the loop is already running every frame regardless).
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

    const live: FxEffect[] = []
    let lastTime = performance.now()
    let raf = 0

    const tick = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05)
      lastTime = time

      const { queue } = useFxStore.getState()
      if (queue.length > 0) {
        useFxStore.setState({ queue: [] })
        for (const request of queue) {
          live.push(createEffect(request.kind, width, height, request.id, request.options))
        }
      }

      ctx.clearRect(0, 0, width, height)
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const finished = live[i].update(dt)
        if (finished) {
          live.splice(i, 1)
          continue
        }
        live[i].draw(ctx, width, height)
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return createPortal(
    <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[90]" />,
    document.body,
  )
}
