import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { usePlanStore, type PlanItem } from '../game/plans/usePlanStore'
import { useIsAdmin } from '../lib/adminConfig'

const CONTENT_MAX_LENGTH = 500

// Plans (2026-08-21, requested by the user) -- re-adds the public roadmap
// list previously called "To-Do". Every player sees a read-only,
// admin-ordered list; only the admin account gets the add/remove controls
// and can drag rows to reorder them (see useIsAdmin's own doc comment for
// why this gate is cosmetic — real enforcement is server-side in
// admin_add_plan/admin_remove_plan/admin_reorder_plans).
//
// Drag implementation is a small self-contained Pointer Events reorder, not
// a reuse of the Forge/Warehouse grid drag system in
// src/components/dragDropContext.ts/dragDrop.tsx — that system is built
// around fixed square item-slot drop zones and elementFromPoint hit-testing
// (later replaced with cached rects there after a reported lag issue, see
// CLAUDE.md), which doesn't fit a linear list-reorder interaction. This
// reads each row's live getBoundingClientRect() on move instead of
// elementFromPoint — fine at this list's small scale (a handful to maybe a
// few dozen rows), unlike the 40-tile grid that prompted the Forge fix.
//
// `dragOrder` is `null` whenever nothing is being dragged — the rendered
// list just derives straight from the store's own `items` order then.
// Deliberately NOT synced from `items` via a useEffect+setState (that's a
// real anti-pattern, flagged by this project's lint config) — it's set
// once at drag start (a plain event handler, not an effect) and reset back
// to null at drag end, falling back to `items` again automatically.
export default function PlanPanel() {
  const items = usePlanStore((state) => state.items)
  const loaded = usePlanStore((state) => state.loaded)
  const busy = usePlanStore((state) => state.busy)
  const loadPlans = usePlanStore((state) => state.loadPlans)
  const addPlan = usePlanStore((state) => state.addPlan)
  const removePlan = usePlanStore((state) => state.removePlan)
  const reorderPlans = usePlanStore((state) => state.reorderPlans)
  const isAdmin = useIsAdmin()

  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragOrder, setDragOrder] = useState<PlanItem[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const draggingIdRef = useRef<string | null>(null)
  const dragOrderRef = useRef<PlanItem[]>(items)
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map())
  const pointerMoveHandlerRef = useRef<((event: PointerEvent) => void) | null>(null)
  const pointerUpHandlerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!loaded) {
      void loadPlans()
    }
  }, [loaded, loadPlans])

  // Cleanup on unmount (e.g. Settings closed mid-drag) -- refs always point
  // at whichever handlers are actually attached, regardless of which
  // render's startDrag call attached them.
  useEffect(() => {
    return () => {
      if (pointerMoveHandlerRef.current) {
        window.removeEventListener('pointermove', pointerMoveHandlerRef.current)
      }
      if (pointerUpHandlerRef.current) {
        window.removeEventListener('pointerup', pointerUpHandlerRef.current)
      }
    }
  }, [])

  const displayItems = dragOrder ?? items

  const handleAdd = async () => {
    const trimmed = content.trim()
    if (!trimmed) {
      return
    }
    setError(null)
    const result = await addPlan(trimmed)
    if (result.ok) {
      setContent('')
    } else {
      setError('Something went wrong adding that.')
    }
  }

  const endDrag = () => {
    const wasDragging = draggingIdRef.current !== null
    const finalOrder = dragOrderRef.current
    draggingIdRef.current = null
    setDraggingId(null)
    setDragOrder(null)

    if (pointerMoveHandlerRef.current) {
      window.removeEventListener('pointermove', pointerMoveHandlerRef.current)
    }
    if (pointerUpHandlerRef.current) {
      window.removeEventListener('pointerup', pointerUpHandlerRef.current)
    }
    pointerMoveHandlerRef.current = null
    pointerUpHandlerRef.current = null

    if (wasDragging) {
      void reorderPlans(finalOrder.map((item) => item.id))
    }
  }

  const startDrag = (id: string) => {
    if (!isAdmin || busy) {
      return
    }
    draggingIdRef.current = id
    dragOrderRef.current = items
    setDraggingId(id)
    setDragOrder(items)

    const handlePointerMove = (event: PointerEvent) => {
      const currentDraggingId = draggingIdRef.current
      if (!currentDraggingId) {
        return
      }

      let overId: string | null = null
      for (const item of dragOrderRef.current) {
        if (item.id === currentDraggingId) {
          continue
        }
        const rect = rowRefs.current.get(item.id)?.getBoundingClientRect()
        if (rect && event.clientY >= rect.top && event.clientY <= rect.bottom) {
          overId = item.id
          break
        }
      }
      if (!overId) {
        return
      }

      const current = dragOrderRef.current
      const fromIndex = current.findIndex((item) => item.id === currentDraggingId)
      const toIndex = current.findIndex((item) => item.id === overId)
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return
      }

      const next = current.slice()
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      dragOrderRef.current = next
      setDragOrder(next)
    }

    pointerMoveHandlerRef.current = handlePointerMove
    pointerUpHandlerRef.current = endDrag
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', endDrag)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Plans</h2>
        <p className="text-sm text-slate-400">What's planned or being worked on next.</p>
      </div>

      {isAdmin && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={content}
              onChange={(event) => {
                setContent(event.target.value.slice(0, CONTENT_MAX_LENGTH))
                setError(null)
              }}
              placeholder="Add a new plan…"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-base text-slate-200"
            />
            <button
              type="button"
              disabled={!content.trim() || busy}
              onClick={() => void handleAdd()}
              className="shrink-0 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {error && <p className="text-xs text-amber-400">{error}</p>}
        </div>
      )}

      {displayItems.length === 0 ? (
        <p className="text-sm text-slate-300">Nothing on the list right now.</p>
      ) : (
        <div className="space-y-2">
          {displayItems.map((item) => (
            <motion.div
              key={item.id}
              layout
              transition={{ duration: 0.18 }}
              ref={(el) => {
                if (el) {
                  rowRefs.current.set(item.id, el)
                } else {
                  rowRefs.current.delete(item.id)
                }
              }}
              className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm text-slate-200 ${
                draggingId === item.id ? 'border-sky-600 bg-sky-500/10' : 'border-slate-800 bg-slate-900/60'
              }`}
            >
              <div className="flex items-start gap-2">
                {isAdmin && (
                  <span
                    onPointerDown={(event) => {
                      event.preventDefault()
                      startDrag(item.id)
                    }}
                    aria-label="Drag to reorder"
                    title="Drag to reorder"
                    className="touch-none select-none px-1 text-slate-300 hover:text-slate-100 active:cursor-grabbing"
                    style={{ cursor: 'grab' }}
                  >
                    ⠿
                  </span>
                )}
                <span className="whitespace-pre-wrap">{item.content}</span>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => void removePlan(item.id)}
                  aria-label="Remove plan"
                  title="Remove plan"
                  className="shrink-0 text-slate-300 hover:text-rose-400"
                >
                  ✕
                </button>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
