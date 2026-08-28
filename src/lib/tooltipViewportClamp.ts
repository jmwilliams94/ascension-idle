// Shared viewport-clamping math for every portaled item-tooltip/popover
// (HoverTooltip's peek, GearEquipPopover, TooltipActionPopover) — all three
// anchor a fixed-position card to a trigger's own bounding rect and need to
// keep it from rendering off-screen. Horizontal width is always known
// upfront (each caller's card has a fixed/derivable width), but vertical
// height depends on the tooltip's actual content (gear with sockets/gems/
// enchant lines runs much taller than a plain potion), which isn't knowable
// until the DOM has actually rendered it. So vertical positioning is a
// two-pass: an approximate guess on first render (same "is the trigger near
// the top of the screen" heuristic this code always used), corrected to the
// real measured height inside a useLayoutEffect before the browser ever
// paints (so nothing visibly jumps). Reported by the user: a tall gear
// tooltip (lots of stat/socket/enchant lines) was overflowing off the top
// of the screen — the old single-pass heuristic assumed tooltips were
// short enough that "is the trigger near the top" alone was enough to pick
// above-vs-below, which stops holding once content runs past a couple
// hundred px tall.
export const TOOLTIP_VIEWPORT_MARGIN = 8
const FLIP_BELOW_GUESS_THRESHOLD = 160

export interface TooltipVerticalStyle {
  top: number
  transform: string
}

// First-render guess, before there's a mounted element to measure.
export function guessTooltipVertical(anchorRect: DOMRect): TooltipVerticalStyle {
  const showBelow = anchorRect.top < FLIP_BELOW_GUESS_THRESHOLD
  return {
    top: showBelow ? anchorRect.bottom + 6 : anchorRect.top - 6,
    transform: `translate(-50%, ${showBelow ? '0' : '-100%'})`,
  }
}

// Real placement once the tooltip's actual height is known (measured via
// ref.getBoundingClientRect() in a useLayoutEffect) — picks whichever side
// actually has room for it, and hard-clamps to the viewport as a last
// resort if neither side does.
export function clampTooltipVertical(anchorRect: DOMRect, height: number): TooltipVerticalStyle {
  const roomAbove = anchorRect.top - TOOLTIP_VIEWPORT_MARGIN
  const roomBelow = window.innerHeight - anchorRect.bottom - TOOLTIP_VIEWPORT_MARGIN
  const showBelow = height > roomAbove && roomBelow > roomAbove

  const top = showBelow
    ? Math.min(anchorRect.bottom + 6, window.innerHeight - height - TOOLTIP_VIEWPORT_MARGIN)
    : Math.max(anchorRect.top - 6 - height, TOOLTIP_VIEWPORT_MARGIN)

  return { top, transform: 'translateX(-50%)' }
}

export function clampTooltipLeft(anchorRect: DOMRect, width: number): number {
  return Math.min(
    Math.max(anchorRect.left + anchorRect.width / 2, width / 2 + TOOLTIP_VIEWPORT_MARGIN),
    window.innerWidth - width / 2 - TOOLTIP_VIEWPORT_MARGIN,
  )
}
