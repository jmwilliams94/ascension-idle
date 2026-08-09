import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Matches ItemTooltip's own w-64 (256px, widened 2026-08-04 alongside the
// doubled tooltip icon to keep the text column's width unchanged) — used
// only for horizontal clamping math below, not for sizing the tooltip itself.
const TOOLTIP_WIDTH = 256
const VIEWPORT_MARGIN = 8
// Heuristic, not a real measurement (the tooltip's height varies with content and
// measuring it would need an extra render pass) — if there's less than this much
// room above the trigger, flip the tooltip below it instead of clipping upward.
const FLIP_BELOW_THRESHOLD = 160

// Touch has no "hover" — long-press is the fallback (confirmed with the user,
// 2026-07-31), not tap-to-toggle: a plain tap already means "select" on nearly
// every tile this wraps (Inventory/Forge/Equipment), so reusing tap for
// "show tooltip" would collide with that. Long-press is a separate gesture by
// construction (time-based, requires stillness) so it can't collide with
// either a tap-to-select or the drag-and-drop gesture (movement-based) that
// some of these same tiles also use — see dragDropContext.ts's own
// movement-threshold, which is the mirror-image reason a hold that never
// moves never starts a drag.
const LONG_PRESS_MS = 450
const LONG_PRESS_MOVE_CANCEL_PX = 10

// Safety net against the tooltip getting permanently stuck (reported: a
// long-press tooltip sometimes stayed pinned mid-screen instead of closing).
// `rect` is a one-time snapshot taken when the tooltip opens, so it goes
// stale the instant the page scrolls, and if the pointerup/pointercancel
// meant to close it never reaches this element (e.g. a drag gesture starting
// elsewhere steals the event), nothing else would ever clear it. This is a
// "peek" tooltip, not persistent UI, so it's safe to force-close it well
// before a real user would still want it open.
const AUTO_DISMISS_MS = 4000

interface HoverTooltipProps {
  content: ReactNode
  children: ReactNode
  // Opt out of the long-press (touch) trigger while keeping mouse hover
  // intact — for tiles where a plain tap already opens a richer popover with
  // this same content (Equipment tab's Compare mode, 2026-08-13), long-press
  // would just be a redundant second gesture for the same information.
  disableTouchPeek?: boolean
}

// Wraps any trigger element and shows `content` on hover (mouse/pen) or
// long-press (touch), portaled into document.body and positioned with
// `position: fixed` from the trigger's own bounding rect — this is what makes
// it immune to clipping by a scrollable/overflow ancestor (e.g. a panel's
// scroll container), unlike a plain CSS absolute-positioned tooltip nested
// inside that same clipped DOM subtree.
export default function HoverTooltip({ content, children, disableTouchPeek = false }: HoverTooltipProps) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const longPressTimerRef = useRef<number | null>(null)
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null)
  // Read-then-cleared by onClickCapture so the tap that ends a long-press
  // doesn't also fire whatever onClick the wrapped tile has (e.g. a select
  // toggle) — same "swallow the click that follows a real gesture" pattern
  // dragDropContext.ts uses for drag-and-drop.
  const longPressFiredRef = useRef(false)

  useEffect(() => {
    if (!rect) {
      return undefined
    }

    const dismiss = () => setRect(null)

    // capture:true so this fires even if something else on the page stops
    // propagation, and so a fresh pointerdown dismisses the *old* tooltip
    // before whatever new gesture it's starting (e.g. another long-press)
    // runs its own bubble-phase handlers.
    window.addEventListener('scroll', dismiss, { capture: true, passive: true })
    window.addEventListener('pointerdown', dismiss, { capture: true })
    const autoDismissTimer = window.setTimeout(dismiss, AUTO_DISMISS_MS)

    return () => {
      window.removeEventListener('scroll', dismiss, { capture: true })
      window.removeEventListener('pointerdown', dismiss, { capture: true })
      window.clearTimeout(autoDismissTimer)
    }
  }, [rect])

  const handleEnter = () => {
    setRect(triggerRef.current?.getBoundingClientRect() ?? null)
  }

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || disableTouchPeek) {
      return
    }
    longPressStartRef.current = { x: event.clientX, y: event.clientY }
    clearLongPressTimer()
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true
      setRect(triggerRef.current?.getBoundingClientRect() ?? null)
    }, LONG_PRESS_MS)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || !longPressStartRef.current) {
      return
    }
    const dx = event.clientX - longPressStartRef.current.x
    const dy = event.clientY - longPressStartRef.current.y
    // Movement past this point reads as a scroll or a drag attempt, not a
    // hold-still-to-peek — cancel before the timer fires rather than showing
    // a tooltip mid-scroll.
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_CANCEL_PX) {
      clearLongPressTimer()
    }
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      return
    }
    clearLongPressTimer()
    longPressStartRef.current = null
    if (longPressFiredRef.current) {
      setRect(null)
    }
  }

  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    // Only suppresses the native long-press callout/context menu some mobile
    // browsers show — longPressFiredRef is only ever set from a touch
    // pointerType, so this never touches desktop right-click behavior
    // (InventorySlot's own onContextMenu prop, used elsewhere for its own
    // right-click shortcuts, is unaffected).
    if (longPressFiredRef.current) {
      event.preventDefault()
    }
  }

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setRect(null)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClickCapture={handleClickCapture}
      onContextMenu={handleContextMenu}
    >
      {children}

      {rect &&
        createPortal(
          <TooltipPositioner rect={rect}>{content}</TooltipPositioner>,
          document.body,
        )}
    </div>
  )
}

function TooltipPositioner({ rect, children }: { rect: DOMRect; children: ReactNode }) {
  const showBelow = rect.top < FLIP_BELOW_THRESHOLD
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, TOOLTIP_WIDTH / 2 + VIEWPORT_MARGIN),
    window.innerWidth - TOOLTIP_WIDTH / 2 - VIEWPORT_MARGIN,
  )
  const top = showBelow ? rect.bottom + 6 : rect.top - 6

  return (
    <div
      className="pointer-events-none fixed z-50"
      style={{ left, top, transform: `translate(-50%, ${showBelow ? '0' : '-100%'})` }}
    >
      {children}
    </div>
  )
}
