import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui/Button'
import { useTutorialStore } from '../game/tutorial/useTutorialStore'
import { TUTORIAL_STEPS } from '../game/tutorial/tutorialSteps'
import { useInventoryStore } from '../game/items/useInventoryStore'

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

// Red border (distinct from every other semantic tint in the app — VIP
// violet, announcements green, etc.) marks a dialogue box as tutorial
// content specifically, never confusable with a real gameplay panel. Same
// reusable .is-tinted mechanism VipStatusHud etc. already use (see
// index.css) rather than a bespoke border.
const TUTORIAL_TINT_STYLE = { '--ascension-tint': '#ef4444' } as CSSProperties

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

// window.innerHeight/innerWidth (and the `fixed inset-0` wrapper's own CSS
// sizing below) track the *layout* viewport, which on mobile can be taller
// than what's actually painted right now (browser chrome sliding in/out) —
// window.visualViewport tracks the real visible area when the browser
// supports it, in the same coordinate space getBoundingClientRect() uses
// (hence offsetTop/offsetLeft, not just width/height). Used to keep the glow
// ring/cutout from ever drawing past the edge of the screen that's actually
// visible right now — reported: the ring around Lucky Lad/Tavern's nav
// buttons had its bottom edge cut off on mobile.
function getVisibleViewportRect(): { top: number; left: number; bottom: number; right: number } {
  const vv = window.visualViewport
  if (!vv) {
    return { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth }
  }
  return { top: vv.offsetTop, left: vv.offsetLeft, bottom: vv.offsetTop + vv.height, right: vv.offsetLeft + vv.width }
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
  const weaponId = useTutorialStore((state) => state.weaponId)
  const advance = useTutorialStore((state) => state.advance)
  const skip = useTutorialStore((state) => state.skip)

  // Completion's '{weaponLevelPhrase}' placeholder — the granted tutorial
  // weapon's real, current level (see grant_tutorial_starter_kit/
  // tutorial_level_upgrade), not a hardcoded 5-for-Wuxia/8-for-Hunter guess.
  const tutorialWeaponLevel = useInventoryStore((state) => (weaponId ? state.items.find((item) => item.id === weaponId)?.level : undefined))

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

  // Longer, informational dialogue (the welcome intro, completion) reads
  // better with more room than the short one-line guided-step prompts.
  const dialogueWidthClass = step.targetId === null ? 'max-w-md' : 'max-w-sm'

  // dialogue is either one line or an array of paragraphs (see
  // tutorialSteps.ts) — an empty-string entry is a blank spacer row rather
  // than real text, for separating two paragraphs by more than the usual
  // paragraph gap. {weaponLevelPhrase} only ever appears on the completion
  // step.
  const weaponLevelPhrase = typeof tutorialWeaponLevel === 'number' ? `level ${tutorialWeaponLevel}` : 'the required level'
  const paragraphs = (Array.isArray(step.dialogue) ? step.dialogue : [step.dialogue]).map((line) =>
    line.replace('{weaponLevelPhrase}', weaponLevelPhrase),
  )

  const dialogue = (
    <div className={`ascension-card-frame is-tinted w-full ${dialogueWidthClass}`} style={TUTORIAL_TINT_STYLE}>
      <div className="ascension-card-inner space-y-3 p-4 text-center">
        {step.heading && <h2 className="font-heading text-lg font-bold text-white">{step.heading}</h2>}
        {paragraphs.map((line, index) =>
          line === '' ? (
            <div key={index} className="h-2" />
          ) : (
            <p key={index} className="text-sm leading-relaxed text-slate-100">
              {line}
            </p>
          ),
        )}
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

  const PAD = 5
  const visible = getVisibleViewportRect()
  const top = Math.max(visible.top, rect.top - PAD)
  const left = Math.max(visible.left, rect.left - PAD)
  const bottom = Math.min(visible.bottom, rect.top + rect.height + PAD)
  const right = Math.min(visible.right, rect.left + rect.width + PAD)
  const dialogueBelow = bottom < visible.bottom - 160

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

      {/* Glowing gold ring around the target — visual only, never intercepts
          clicks. Sized from the clamped top/left/bottom/right (not the raw
          rect+PAD) so it can never draw past the edge of the visible screen. */}
      <div
        className="pointer-events-none absolute rounded-xl border-2 border-amber-400 shadow-[0_0_18px_rgba(212,175,55,0.65)]"
        style={{ top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }}
      />

      <div
        className="pointer-events-auto absolute flex justify-center px-4"
        style={
          dialogueBelow
            ? { top: bottom + 12, left: 0, right: 0 }
            : { bottom: visible.bottom - top + 12, left: 0, right: 0 }
        }
      >
        {dialogue}
      </div>
    </div>,
    document.body,
  )
}
