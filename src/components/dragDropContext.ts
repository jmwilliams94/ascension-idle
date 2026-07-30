import { createContext, useContext, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

// A minimal cross-input (mouse + touch + pen) drag-and-drop primitive built on
// Pointer Events, used only within Forge. Replaces native HTML5 drag-and-drop
// (draggable/dragstart/dragover/drop), which never fires on touchscreens — see
// CLAUDE.md's "PWA & Mobile" section. A drop target just needs a
// `data-forge-drop="<key>"` attribute on its wrapper element; the drag source
// resolves which target (if any) is under the pointer via
// `document.elementFromPoint`, so drop targets themselves need no handlers.
// Split from dragDrop.tsx (which holds the components) because a file mixing
// component and non-component exports breaks React Fast Refresh.

const DRAG_THRESHOLD_PX = 6

export interface DragPayload {
  id: string
  icon: string
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

export function resolveDropTarget(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y)
  const target = element?.closest<HTMLElement>('[data-forge-drop]')
  return target?.dataset.forgeDrop ?? null
}

function useDragDropContext(): DragDropContextValue {
  const context = useContext(DragDropContext)
  if (!context) {
    throw new Error('useDraggableTile must be used within a DragDropProvider')
  }
  return context
}

interface UseDraggableTileArgs {
  enabled: boolean
  payload: DragPayload | null
  // overTarget is whatever data-forge-drop key the pointer was released over
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
    drag.updateDrag(event.clientX, event.clientY)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    startRef.current = null
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
