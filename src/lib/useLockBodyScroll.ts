import { useEffect } from 'react'

// Locks background page scroll while a full-screen modal/overlay is open
// (2026-08-28, reported by the user -- a touch-drag on a scrollable pane
// inside a modal, e.g. SettingsModal's admin Suggestions/Bug Reports
// queue, was scroll-chaining into the game page behind it once the touch
// reached the modal's own scroll boundary). This app scrolls at the
// document/body level (index.css's `html, body, #root { min-height: 100%
// }`, no fixed-height app-shell-with-internal-scroll), so the fix locks
// <body> itself -- via `position: fixed` pinned at the current scroll
// offset, not just `overflow: hidden`, since iOS Safari doesn't reliably
// respect plain overflow:hidden on <body> for touch scrolling. Restores
// the exact scroll position once no longer active.
//
// `active` defaults to true for the common case (a modal component that's
// only ever mounted by its parent while open, e.g. `{show && <XModal />}`)
// -- pass it explicitly for a component that stays mounted itself and
// toggles an internal open flag instead (ChatOverlay, ZoneBossCard's
// repair-alert block), since calling this unconditionally on an
// always-mounted component would lock scroll for the component's entire
// lifetime rather than just while its modal is actually showing.
//
// Module-level reference count (2026-09-01, fix -- reported by the user:
// claiming mail then switching tabs left every page permanently unable to
// scroll). ~13 components call this hook, several mounted globally and
// independent of each other (e.g. ChatOverlay can be open while a Marketplace
// tab modal like MailDetailModal is also open). The previous per-call version
// snapshotted body's *current* style on each lock and restored that exact
// snapshot on unlock -- fine for one lock at a time, but if two locks were
// ever active concurrently and closed out of LIFO order, the second one to
// close would restore a stale snapshot captured while the *other* lock was
// already active (i.e. `position: fixed`), permanently pinning body to fixed
// with no further cleanup left to undo it. Counting locks and only touching
// body on the true 0->1 (capture natural state) and 1->0 (restore it)
// transitions makes this correct regardless of how many locks are active or
// what order they close in.
let lockCount = 0
let savedScrollY = 0
let previousBodyStyle: { position: string; top: string; left: string; right: string; width: string } | null = null

function lockBody() {
  if (lockCount === 0) {
    savedScrollY = window.scrollY
    const { body } = document
    previousBodyStyle = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    }

    body.style.position = 'fixed'
    body.style.top = `-${savedScrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
  }

  lockCount += 1
}

function unlockBody() {
  lockCount -= 1

  if (lockCount === 0 && previousBodyStyle !== null) {
    const { body } = document
    body.style.position = previousBodyStyle.position
    body.style.top = previousBodyStyle.top
    body.style.left = previousBodyStyle.left
    body.style.right = previousBodyStyle.right
    body.style.width = previousBodyStyle.width
    window.scrollTo(0, savedScrollY)
    previousBodyStyle = null
  }
}

export function useLockBodyScroll(active = true) {
  useEffect(() => {
    if (!active) {
      return
    }

    lockBody()
    return () => unlockBody()
  }, [active])
}
