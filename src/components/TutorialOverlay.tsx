import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui/Button'
import { useTutorialStore } from '../game/tutorial/useTutorialStore'
import { TUTORIAL_STEPS } from '../game/tutorial/tutorialSteps'

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

// Desktop (TabNav) and mobile (MobileBottomNav) each render their own real
// nav buttons unconditionally — the inactive one is only CSS-hidden
// (`hidden lg:grid` etc.), not unmounted, so both can share a data-tutorial-id
// and both match this query at once. A CSS-hidden element's
// getBoundingClientRect() is always {0,0,0,0}, so picking the first *visible*
// (non-zero-size) match is enough to always land on the one actually on
// screen — same reasoning covers Forge's mobile-only Tavern rollup, where
// the Tavern toggle and the rolled-out Forge item share 'nav-forge' too (see
// MobileBottomNav.tsx) and only one of the two exists/has size at a time.
// Clamps a target's rect against any real, currently-visible fixed-position
// chrome it may visually continue underneath — e.g. mobile's fixed bottom
// nav bar (marked data-fixed-chrome="bottom", see MobileBottomNav.tsx),
// which a scrollable panel like Forge's Inventory grid extends past in
// normal document flow. Without this, the spotlight (portaled well above
// everything, so it can dim the whole app) would draw its cutout/glow ring
// straight through the nav bar instead of stopping where the visible
// content actually ends — reported as the highlight "appearing over the top
// of the nav bar."
function clampToFixedChrome(el: Element, rect: Rect): Rect {
  const bottomChrome = document.querySelector('[data-fixed-chrome="bottom"]')
  // Skip entirely when the target itself lives inside the chrome (e.g.
  // spotlighting the nav bar's own Lucky/Forge buttons) — those are meant
  // to draw over the chrome, not be clamped against it.
  if (!bottomChrome || bottomChrome === el || bottomChrome.contains(el)) {
    return rect
  }
  const chromeRect = bottomChrome.getBoundingClientRect()
  if (chromeRect.width === 0 && chromeRect.height === 0) {
    return rect
  }
  const clampedBottom = Math.min(rect.top + rect.height, chromeRect.top)
  return { ...rect, height: Math.max(0, clampedBottom - rect.top) }
}

// Desktop (TabNav) and mobile (MobileBottomNav) each render their own real
// nav buttons unconditionally — the inactive one is only CSS-hidden
// (`hidden lg:grid` etc.), not unmounted, so both can share a data-tutorial-id
// and both match this query at once. A CSS-hidden element's
// getBoundingClientRect() is always {0,0,0,0}, so picking the first *visible*
// (non-zero-size) match is enough to always land on the one actually on
// screen — same reasoning covers Forge's mobile-only Tavern rollup, where
// the Tavern toggle and the rolled-out Forge item share 'nav-forge' too (see
// MobileBottomNav.tsx) and only one of the two exists/has size at a time.
function measureTarget(targetId: string): Rect | null {
  const candidates = document.querySelectorAll(`[data-tutorial-id="${targetId}"]`)
  for (const el of candidates) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 || rect.height > 0) {
      return clampToFixedChrome(el, { top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    }
  }
  return null
}

// First-login tutorial spotlight (admin-only for now — see CLAUDE.md). No
// existing spotlight/cutout system in this codebase to reuse, so this is new:
// a real target element's own data-tutorial-id attribute (sitting on the
// actual production button — never a fake/synthetic one) drives a 4-band
// dim cutout around it. The target itself is never wrapped or intercepted —
// it sits in the natural gap between the 4 bands, so its own onClick fires
// normally and the tutorial only ever reacts to that, never causes it.
//
// Portaled to document.body (rather than rendered inline from App.tsx) per
// CLAUDE.md's clip-path/fixed-modal-containment gotcha — keeps this correct
// regardless of what ends up wrapping it later.
export default function TutorialOverlay() {
  const active = useTutorialStore((state) => state.active)
  const stepIndex = useTutorialStore((state) => state.stepIndex)
  const advance = useTutorialStore((state) => state.advance)
  const skip = useTutorialStore((state) => state.skip)

  const step = active ? TUTORIAL_STEPS[stepIndex] : null
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => {
    if (!step || !step.targetId) {
      setRect(null)
      return undefined
    }

    const targetId = step.targetId
    const measure = () => setRect(measureTarget(targetId))
    measure()

    // No existing spotlight system means no existing "target moved/mounted"
    // signal to hook into either — a short poll is the simplest robust way
    // to track a target across tab switches, animated layout, and scrolling
    // without wiring a bespoke observer into every spotlighted component.
    const interval = window.setInterval(measure, 200)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step])

  if (!step) {
    return null
  }

  const dialogue = (
    <div className="ascension-card-frame w-full max-w-sm">
      <div className="ascension-card-inner space-y-3 p-4 text-center">
        <p className="text-sm leading-relaxed text-slate-100">{step.dialogue}</p>
        {step.targetId === null || step.requiresManualAdvance ? (
          <Button variant="primary" onClick={() => advance()} className="w-full">
            {step.id === 'welcome' ? 'Get Started' : step.id === 'completion' ? 'Finish' : 'Continue'}
          </Button>
        ) : null}
        <button
          type="button"
          onClick={() => skip()}
          className="block w-full text-center text-xs text-slate-500 transition hover:text-slate-300"
        >
          Skip Tutorial
        </button>
      </div>
    </div>
  )

  // No cutout (welcome/completion) — full-dim centered card, same visual
  // language as TermsAcceptanceModal.
  if (!step.targetId || !rect) {
    return createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-4">{dialogue}</div>,
      document.body,
    )
  }

  const PAD = 8
  const top = rect.top - PAD
  const left = rect.left - PAD
  const bottom = rect.top + rect.height + PAD
  const right = rect.left + rect.width + PAD
  const dialogueBelow = bottom < window.innerHeight - 160

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70]">
      {/* 4 dim bands around the cutout — each pointer-events:auto so clicks
          outside the spotlighted target are swallowed; the natural gap
          between them (the target's own rect) is never covered, so the real
          button underneath stays clickable exactly as normal. */}
      <div className="pointer-events-auto absolute inset-x-0 top-0 bg-slate-950/35" style={{ height: Math.max(0, top) }} />
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 bg-slate-950/35" style={{ top: Math.max(0, bottom) }} />
      <div
        className="pointer-events-auto absolute bg-slate-950/35"
        style={{ top: Math.max(0, top), height: Math.max(0, bottom - top), left: 0, width: Math.max(0, left) }}
      />
      <div
        className="pointer-events-auto absolute bg-slate-950/35"
        style={{ top: Math.max(0, top), height: Math.max(0, bottom - top), left: Math.max(0, right), right: 0 }}
      />

      {/* Glowing gold ring around the target — visual only, never intercepts clicks. */}
      <div
        className="pointer-events-none absolute rounded-xl border-2 border-amber-400 shadow-[0_0_18px_rgba(212,175,55,0.65)]"
        style={{ top: Math.max(0, top), left: Math.max(0, left), width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
      />

      <div
        className="pointer-events-auto absolute flex justify-center px-4"
        style={
          dialogueBelow
            ? { top: bottom + 12, left: 0, right: 0 }
            : { bottom: window.innerHeight - top + 12, left: 0, right: 0 }
        }
      >
        {dialogue}
      </div>
    </div>,
    document.body,
  )
}
