import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import ItemTooltip from './ItemTooltip'
import type { ItemTooltipData } from '../game/items/itemTooltip'

// Inventory-grid-only (confirmed with the user, 2026-08-03 — scoped away from
// Forge/Warehouse/Shop/Equipment's own gear tiles, which all keep today's
// hover-peek ItemTooltip + separate below-grid detail card unchanged). Press
// a gear tile → this opens instead of the old detail card, showing the same
// ItemTooltip content plus Equip/Compare buttons directly in it — replaces
// the previous two-step "hover to peek, click to select-then-scroll-to-the-
// card-below" flow with one click-opened, self-contained popover.
//
// Deliberately a new component rather than extending HoverTooltip — that one
// is a pure hover/long-press "peek" (its content wrapper is
// pointer-events-none, so nothing inside it can ever be clicked) dismissed by
// mouseleave/scroll/timeout. This is the opposite shape: click-opened,
// interactive, and dismissed only by an explicit action (Equip), clicking
// outside it, Escape, or clicking the tile again — reusing HoverTooltip's
// mouseleave-based dismissal here would close it the instant the pointer
// left the trigger, before a tap on Equip/Compare could ever land.
const POPOVER_CARD_WIDTH = 208 // matches ItemTooltip's own w-52 (208px)
const VIEWPORT_MARGIN = 8
const FLIP_BELOW_THRESHOLD = 160
// Below this viewport width, two 208px cards plus their gap won't fit
// side by side — Compare stacks vertically instead (see the render below).
const SIDE_BY_SIDE_MIN_VIEWPORT = 640

interface GearEquipPopoverProps {
  anchorRect: DOMRect
  tooltip: ItemTooltipData
  // The item currently equipped in this same slot, if any — null when this
  // would be a first-time equip into an empty slot, in which case Compare
  // simply doesn't render (confirmed with the user: no "Nothing equipped"
  // placeholder side, the button itself just isn't offered).
  compareTooltip: ItemTooltipData | null
  alreadyEquipped: boolean
  canEquip: boolean
  equipLabel: string
  onEquip: () => void
  onClose: () => void
}

export default function GearEquipPopover({
  anchorRect,
  tooltip,
  compareTooltip,
  alreadyEquipped,
  canEquip,
  equipLabel,
  onEquip,
  onClose,
}: GearEquipPopoverProps) {
  const [comparing, setComparing] = useState(false)

  useEffect(() => {
    // Outside-pointerdown-to-dismiss, not mouseleave (this is a click-opened
    // popover, not a hover peek). data-gear-popover-anchor marks every
    // popover-eligible tile (not just the currently open one) so clicking a
    // *different* gear tile is left entirely to that tile's own onClick
    // (which already handles switching the selection) rather than this
    // listener racing it closed first.
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-gear-popover]') && !target.closest('[data-gear-popover-anchor]')) {
        onClose()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const sideBySide = comparing && Boolean(compareTooltip) && window.innerWidth >= SIDE_BY_SIDE_MIN_VIEWPORT
  const width = sideBySide ? POPOVER_CARD_WIDTH * 2 + 8 : POPOVER_CARD_WIDTH
  const showBelow = anchorRect.top < FLIP_BELOW_THRESHOLD
  const left = Math.min(
    Math.max(anchorRect.left + anchorRect.width / 2, width / 2 + VIEWPORT_MARGIN),
    window.innerWidth - width / 2 - VIEWPORT_MARGIN,
  )
  const top = showBelow ? anchorRect.bottom + 6 : anchorRect.top - 6

  return createPortal(
    <div
      data-gear-popover
      className="fixed z-50"
      style={{ left, top, transform: `translate(-50%, ${showBelow ? '0' : '-100%'})` }}
      // Stops a tap on the popover's own content (e.g. its background padding,
      // not one of its buttons) from bubbling up to the window pointerdown
      // listener above and self-dismissing.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={`flex gap-2 ${sideBySide ? 'flex-row' : 'flex-col'}`}>
        <ItemTooltip {...tooltip} />
        {comparing && compareTooltip && <ItemTooltip {...compareTooltip} />}
      </div>
      <div className="mt-1.5 flex gap-1.5 rounded-lg border border-slate-700 bg-slate-950/95 p-1.5 shadow-xl shadow-black/50">
        <button
          type="button"
          disabled={!canEquip}
          onClick={() => {
            onEquip()
            onClose()
          }}
          className="flex-1 rounded-md border border-sky-500 bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {equipLabel}
        </button>
        {compareTooltip && !alreadyEquipped && (
          <button
            type="button"
            onClick={() => setComparing((current) => !current)}
            className="flex-1 rounded-md border border-slate-600 px-2 py-1 text-xs font-medium text-slate-300 hover:border-slate-400"
          >
            {comparing ? 'Hide Compare' : 'Compare'}
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
