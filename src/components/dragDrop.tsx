import { useCallback, useMemo, useRef, useState } from 'react'
import type { ComponentProps, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { DragDropContext, queryDropZoneRects, resolveDropTarget, useDraggableTile } from './dragDropContext'
import type { ActiveDrag, DragPayload, DropZoneRect } from './dragDropContext'

export function DragDropProvider({ children }: { children: ReactNode }) {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null)
  const activeDragRef = useRef<ActiveDrag | null>(null)
  // Snapshotted once per drag (drop zones don't move mid-drag in this UI) so
  // every subsequent pointermove's hit test is plain in-memory rect math
  // instead of a DOM query — see dragDropContext.ts's queryDropZoneRects doc
  // comment for why this replaced the old elementFromPoint-per-move approach.
  const dropZoneRectsRef = useRef<DropZoneRect[]>([])
  // The ghost's raw pixel position is written directly to this node's style
  // every frame (see positionGhost below) instead of through React state —
  // `activeDrag`/setActiveDrag previously carried x/y too, which meant EVERY
  // consumer of DragDropContext (every draggable tile in the whole grid, plus
  // every Forge drop-zone using useIsDropTarget) re-rendered on every single
  // pointermove frame, since the context's `value` object is a fresh literal
  // each render and `activeDrag` was changing every frame. That re-render
  // storm — not just the ghost's own paint — was reported by the user as the
  // ghost visibly lagging up to a second behind the real cursor once the
  // main thread fell behind. Position now bypasses React entirely; state
  // only updates (and consumers only re-render) when `overTarget` actually
  // changes zones, which happens rarely, not every pixel.
  const ghostRef = useRef<HTMLDivElement>(null)

  const positionGhost = (x: number, y: number) => {
    if (ghostRef.current) {
      ghostRef.current.style.left = `${x}px`
      ghostRef.current.style.top = `${y}px`
    }
  }

  const startDrag = useCallback((payload: DragPayload, x: number, y: number) => {
    dropZoneRectsRef.current = queryDropZoneRects()
    const next: ActiveDrag = { ...payload, x, y, overTarget: resolveDropTarget(x, y, dropZoneRectsRef.current) }
    activeDragRef.current = next
    setActiveDrag(next)
  }, [])

  const updateDrag = useCallback((x: number, y: number) => {
    if (!activeDragRef.current) {
      return
    }
    const overTarget = resolveDropTarget(x, y, dropZoneRectsRef.current)
    const overTargetChanged = overTarget !== activeDragRef.current.overTarget
    activeDragRef.current = { ...activeDragRef.current, x, y, overTarget }
    positionGhost(x, y)
    // Only a real state update (and therefore a context-consumer re-render)
    // when the highlighted drop zone actually changes — see the ghostRef
    // comment above for why position updates deliberately skip this.
    if (overTargetChanged) {
      setActiveDrag(activeDragRef.current)
    }
  }, [])

  const endDrag = useCallback(() => {
    const current = activeDragRef.current
    activeDragRef.current = null
    setActiveDrag(null)
    return current ? { id: current.id, overTarget: current.overTarget } : null
  }, [])

  const cancelDrag = useCallback(() => {
    activeDragRef.current = null
    setActiveDrag(null)
  }, [])

  const contextValue = useMemo(
    () => ({ activeDrag, startDrag, updateDrag, endDrag, cancelDrag }),
    [activeDrag, startDrag, updateDrag, endDrag, cancelDrag],
  )

  return (
    <DragDropContext.Provider value={contextValue}>
      {children}
      {activeDrag &&
        createPortal(
          <div
            ref={ghostRef}
            className={`pointer-events-none fixed z-[9999] flex items-center justify-center rounded-lg border-2 border-slate-500 bg-slate-800/90 text-lg shadow-xl ${SLOT_SIZE_CLASS}`}
            style={{
              left: activeDrag.x,
              top: activeDrag.y,
              // Offset above the pointer so a finger doesn't hide the ghost —
              // resolveDropTarget (dragDropContext.ts) knows this exact offset
              // and checks the ghost's own visual position for a drop target
              // too, not just the raw pointer, so releasing wherever the icon
              // visibly sits counts as a drop.
              transform: 'translate(-50%, calc(-50% - 56px))',
              borderColor: activeDrag.qualityColor,
            }}
          >
            {activeDrag.iconSrc ? <img src={activeDrag.iconSrc} alt="" className="h-4/5 w-4/5 object-contain" /> : activeDrag.icon}
            {activeDrag.badge && (
              <span className="absolute bottom-0.5 right-1 text-[9px] font-semibold text-slate-200">{activeDrag.badge}</span>
            )}
          </div>,
          document.body,
        )}
    </DragDropContext.Provider>
  )
}

type BaseSlotProps = Omit<
  ComponentProps<typeof InventorySlot>,
  'draggable' | 'dragging' | 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onClick'
>

interface DraggableInventorySlotProps extends BaseSlotProps {
  dragEnabled: boolean
  dragPayload: DragPayload | null
  onDrop: (overTarget: string | null, draggedId: string) => void
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void
}

// Wraps InventorySlot with useDraggableTile — split out as its own component
// (rather than calling the hook inline per-tile inside a .map()) so each tile
// gets its own proper hook-owning component instance, per the rules of hooks.
// Only mount this inside a DragDropProvider (i.e. only when the caller actually
// wants drag-and-drop, such as Forge) — useDraggableTile throws otherwise.
export function DraggableInventorySlot({ dragEnabled, dragPayload, onDrop, onClick, ...slotProps }: DraggableInventorySlotProps) {
  const drag = useDraggableTile({ enabled: dragEnabled, payload: dragPayload, onDrop, onClick })

  return (
    <InventorySlot
      {...slotProps}
      draggable={drag.draggable}
      dragging={drag.dragging}
      onClick={drag.onClick}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
    />
  )
}
