import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Matches ItemTooltip's own w-52 (208px) — used only for horizontal clamping math
// below, not for sizing the tooltip itself.
const TOOLTIP_WIDTH = 208
const VIEWPORT_MARGIN = 8
// Heuristic, not a real measurement (the tooltip's height varies with content and
// measuring it would need an extra render pass) — if there's less than this much
// room above the trigger, flip the tooltip below it instead of clipping upward.
const FLIP_BELOW_THRESHOLD = 160

interface HoverTooltipProps {
  content: ReactNode
  children: ReactNode
}

// Wraps any trigger element and shows `content` on hover, portaled into
// document.body and positioned with `position: fixed` from the trigger's own
// bounding rect — this is what makes it immune to clipping by a scrollable/
// overflow ancestor (e.g. OverlayPanel's scroll container), unlike a plain CSS
// absolute-positioned tooltip nested inside that same clipped DOM subtree.
export default function HoverTooltip({ content, children }: HoverTooltipProps) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const handleEnter = () => {
    setRect(triggerRef.current?.getBoundingClientRect() ?? null)
  }

  return (
    <div ref={triggerRef} onMouseEnter={handleEnter} onMouseLeave={() => setRect(null)}>
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
