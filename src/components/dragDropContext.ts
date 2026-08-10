import { createContext, useContext, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

// A minimal cross-input (mouse + touch + pen) drag-and-drop primitive built on
// Pointer Events, originally built for Forge only, generalized 2026-07-31
// when the Bank's own native-DnD gap was fixed the same way (the Bank tab
// rework, 2026-08-03, later dropped drag-and-drop between its two views
// entirely — see BankPanel.tsx — so `"warehouse-storage"`/`"inventory"` is no
// longer a live example of this, just Forge's own keys remain in active use).
// Replaces native HTML5 drag-and-drop (draggable/dragstart/dragover/drop),
// which never fires on touchscreens — see CLAUDE.md's "PWA & Mobile" section.
// A drop target just needs a `data-drop-zone="<key>"` attribute on its
// wrapper element; the drag source resolves which target (if any) is under
// the pointer via cached bounding-rect math (see queryDropZoneRects below),
// so drop targets themselves need no handlers. Key namespacing is the
// caller's responsibility — Forge
// uses `"upgrade"`/`"fuel-0"`/`"fuel-1"`; each page's own DragDropProvider is
// a separate React context, so there's no cross-page collision risk even
// though the keys aren't prefixed.
// Split from dragDrop.tsx (which holds the components) because a file mixing
// component and non-component exports breaks React Fast Refresh.

const DRAG_THRESHOLD_PX = 6

// The floating drag ghost (see dragDrop.tsx's DragDropProvider) renders
// visually offset above the raw pointer position — `translate(-50%,
// calc(-50% - 56px))` — so a finger/cursor doesn't hide the very tile it's
// dragging. Bug fix (2026-08-03): drop-target resolution used to check only
// the raw pointer position, on the theory that the offset "can't throw off
// a drop" — but it can and did: releasing while the *ghost icon* visually
// overlapped a drop zone could still miss, because the real pointer
// position (hidden beneath the ghost, which is the entire reason for the
// offset) was just outside that zone's bounds. Now checks the ghost's own
// visual center first, falling back to the raw pointer position, so
// dropping wherever the icon visibly sits — not just wherever the finger
// happens to be — counts.
const GHOST_VERTICAL_OFFSET_PX = 56
const GHOST_HALF_HEIGHT_MOBILE_PX = 28 // SLOT_SIZE_CLASS's h-14 (56px) / 2
const GHOST_HALF_HEIGHT_DESKTOP_PX = 32 // SLOT_SIZE_CLASS's lg:h-16 (64px) / 2
const DESKTOP_BREAKPOINT_PX = 1024 // Tailwind's `lg`

export interface DragPayload {
  id: string
  icon: string
  // Real art, when supplied, renders in the floating drag ghost instead of the
  // emoji `icon` above — same "iconSrc wins when both are supplied" pattern as
  // InventorySlot's own icon/iconSrc props (see forgeCosts.ts's
  // COMET_ICON_SRC/FALLEN_STAR_ICON_SRC). Without this, Comet/Fallen Star
  // tiles (the only draggable tiles with real art instead of an emoji) had to
  // fall back to a plain emoji ghost mid-drag, which read as "an older image"
  // even though the tile itself, before and after dragging, showed the real
  // art correctly.
  iconSrc?: string
  qualityColor?: string
  badge?: string
}

export interface ActiveDrag extends DragPayload {
  x: number
  y: number
  overTarget: string | null
}

export interface DragDropContextValue {
  activeDrag: ActiveDrag | null
  startDrag: (payload: DragPayload, x: number, y: number) => void
  updateDrag: (x: number, y: number) => void
  endDrag: () => { id: string; overTarget: string | null } | null
  cancelDrag: () => void
}

export const DragDropContext = createContext<DragDropContextValue | null>(null)

export interface DropZoneRect {
  key: string
  rect: DOMRect
}

// Snapshotting every `[data-drop-zone]` element's bounding rect once, at drag
// start, rather than hit-testing the live DOM on every pointermove. The old
// approach called `document.elementFromPoint` up to twice per move (see git
// history) — that forces the browser to flush any pending layout before it
// can answer, and with a React state update (the ghost tile's position)
// landing right after each one, the two together formed a continuous
// read-after-write layout-thrashing loop for the entire duration of a drag.
// Profiling (2026-08-20, reported by the user: the *first* item dragged into
// Forge felt laggy, every drag after felt smooth) showed "Rendering" as the
// dominant main-thread cost and a ~500ms Presentation Delay on an interaction
// whose own handler took ~30ms — consistent with forced layout, not
// scripting. Drop zones don't move mid-drag in this UI, so caching their
// rects once and doing plain point-in-rect math on every move is equivalent
// in behavior but never touches the DOM/layout at all after drag-start.
export function queryDropZoneRects(): DropZoneRect[] {
  const elements = document.querySelectorAll<HTMLElement>('[data-drop-zone]')
  return Array.from(elements, (element) => ({ key: element.dataset.dropZone as string, rect: element.getBoundingClientRect() }))
}

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

// Iterates back-to-front so a later-in-DOM (visually topmost, for this app's
// non-overlapping drop zones effectively "more specific") zone wins on the
// rare chance two rects overlap — approximates elementFromPoint's own
// topmost-wins behavior without needing an actual paint-order hit test.
function hitTestDropZone(x: number, y: number, zones: DropZoneRect[]): string | null {
  for (let i = zones.length - 1; i >= 0; i -= 1) {
    if (pointInRect(x, y, zones[i].rect)) {
      return zones[i].key
    }
  }
  return null
}

export function resolveDropTarget(x: number, y: number, zones: DropZoneRect[]): string | null {
  const halfHeight = window.innerWidth >= DESKTOP_BREAKPOINT_PX ? GHOST_HALF_HEIGHT_DESKTOP_PX : GHOST_HALF_HEIGHT_MOBILE_PX
  const ghostY = y - GHOST_VERTICAL_OFFSET_PX - halfHeight

  return hitTestDropZone(x, ghostY, zones) ?? hitTestDropZone(x, y, zones)
}

function useDragDropContext(): DragDropContextValue {
  const context = useContext(DragDropContext)
  if (!context) {
    throw new Error('useDraggableTile must be used within a DragDropProvider')
  }
  return context
}

// Snap-highlight feedback (2026-08-07, confirmed with the user: "add a
// highlight around the box that is being dragged into once the item is
// close enough so that it can snap into place"). ActiveDrag.overTarget is
// already recomputed on every pointer move by resolveDropTarget's own
// ghost-aware hit test — this just exposes "is MY zone the current one" to
// whichever drop-zone component wants to render a highlight, so nothing
// about the hit-testing itself needs to change. Returns false (never
// throws) outside a DragDropProvider, so a component can call this
// unconditionally even on a page with no active drag session.
export function useIsDropTarget(zoneKey: string): boolean {
  const context = useContext(DragDropContext)
  return context?.activeDrag?.overTarget === zoneKey
}

interface UseDraggableTileArgs {
  enabled: boolean
  payload: DragPayload | null
  // overTarget is whatever data-drop-zone key the pointer was released over
  // (or null if released somewhere with no valid target) — same "no-op if
  // nowhere valid" behavior the old native-DnD drop targets already had.
  onDrop: (overTarget: string | null, draggedId: string) => void
  onClick?: () => void
}

interface DraggableTileHandlers {
  draggable: boolean
  dragging: boolean
  onClick?: () => void
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

// Spread the returned handlers onto an InventorySlot. Handles the drag gesture
// itself (pointer capture, movement threshold, driving the floating ghost via
// context) and swallows the click that would otherwise follow a completed
// drag-and-drop, so dropping a tile doesn't also toggle its selection.
export function useDraggableTile({ enabled, payload, onDrop, onClick }: UseDraggableTileArgs): DraggableTileHandlers {
  const drag = useDragDropContext()
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)
  const justDraggedRef = useRef(false)
  // Coalesces bursts of pointermove events (a precise mouse/touchpad can fire
  // several per animation frame) down to one drag.updateDrag call per frame,
  // rather than one React state update per raw event.
  const pendingPointRef = useRef<{ x: number; y: number } | null>(null)
  const rafIdRef = useRef<number | null>(null)

  const flushPendingMove = () => {
    rafIdRef.current = null
    if (pendingPointRef.current) {
      drag.updateDrag(pendingPointRef.current.x, pendingPointRef.current.y)
      pendingPointRef.current = null
    }
  }

  const cancelPendingMove = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    pendingPointRef.current = null
  }

  // Used on pointerup, not pointercancel — a drop must resolve against the
  // freshest pointer position, not whatever the last *painted* frame had. A
  // fast flick can pointerdown+move+up within a single animation frame,
  // before the throttled rAF callback ever runs; cancelling instead of
  // flushing here would silently drop that final move and resolve the drop
  // against a stale (pre-move) overTarget.
  const flushPendingMoveNow = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    if (pendingPointRef.current) {
      drag.updateDrag(pendingPointRef.current.x, pendingPointRef.current.y)
      pendingPointRef.current = null
    }
  }

  const dragging = enabled && payload !== null && drag.activeDrag?.id === payload.id

  if (!enabled || !payload) {
    return { draggable: false, dragging: false, onClick }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }
    startRef.current = { x: event.clientX, y: event.clientY }
    draggingRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!startRef.current) {
      return
    }

    if (!draggingRef.current) {
      const dx = event.clientX - startRef.current.x
      const dy = event.clientY - startRef.current.y
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return
      }
      draggingRef.current = true
      drag.startDrag(payload, event.clientX, event.clientY)
    }

    event.preventDefault()
    pendingPointRef.current = { x: event.clientX, y: event.clientY }
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(flushPendingMove)
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    startRef.current = null
    flushPendingMoveNow()
    if (draggingRef.current) {
      draggingRef.current = false
      justDraggedRef.current = true
      const result = drag.endDrag()
      if (result) {
        onDrop(result.overTarget, result.id)
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    cancelPendingMove()
    startRef.current = null
    if (draggingRef.current) {
      draggingRef.current = false
      drag.cancelDrag()
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleClick = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false
      return
    }
    onClick?.()
  }

  return {
    draggable: true,
    dragging,
    onClick: handleClick,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
  }
}
