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
export function useLockBodyScroll(active = true) {
  useEffect(() => {
    if (!active) {
      return
    }

    const scrollY = window.scrollY
    const { body } = document
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    }

    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'

    return () => {
      body.style.position = previous.position
      body.style.top = previous.top
      body.style.left = previous.left
      body.style.right = previous.right
      body.style.width = previous.width
      window.scrollTo(0, scrollY)
    }
  }, [active])
}
