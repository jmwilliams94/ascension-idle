import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import ItemTooltip from './ItemTooltip'
import type { ItemTooltipData } from '../game/items/itemTooltip'

// Generic click-opened, portaled action popover — the same shell
// GearEquipPopover established (click a tile → an actionable card anchored
// to it, dismissed by clicking outside/Escape/an action firing), generalized
// to a plain list of buttons instead of Equip/Compare specifically. Used by
// InventoryPanel's Bank-tab Deposit action (2026-08-03, confirmed with the
// user) — a gear/stone tile in the Bank tab's Inventory grid had no
// click-based deposit path at all before this (drag-to-Storage was the only
// way), unlike Bank Storage tiles, which already open a detail card
// defaulting to a one-click free-tier Withdraw.
const POPOVER_CARD_WIDTH = 256 // matches ItemTooltip's own w-64 (256px)
const VIEWPORT_MARGIN = 8
const FLIP_BELOW_THRESHOLD = 160

export interface TooltipActionPopoverAction {
  label: string
  onClick: () => void
  disabled?: boolean
  // 'warning' renders the button red instead of the default sky-blue — used
  // when it's disabled specifically because its destination is full
  // (2026-08-07, confirmed with the user: "maybe turn it red if inventory
  // is full"), so the reason is visible at a glance rather than only in a
  // hover title.
  tone?: 'default' | 'warning'
}

interface TooltipActionPopoverProps {
  anchorRect: DOMRect
  tooltip: ItemTooltipData
  actions: TooltipActionPopoverAction[]
  onClose: () => void
}

export default function TooltipActionPopover({ anchorRect, tooltip, actions, onClose }: TooltipActionPopoverProps) {
  useEffect(() => {
    // Same outside-pointerdown-dismiss pattern as GearEquipPopover — see that
    // component for the full reasoning. data-tooltip-action-anchor marks
    // every popover-eligible tile (not just the currently open one), same
    // "let a different tile's own onClick handle the transition" reasoning.
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-tooltip-action-popover]') && !target.closest('[data-tooltip-action-anchor]')) {
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

  const showBelow = anchorRect.top < FLIP_BELOW_THRESHOLD
  const left = Math.min(
    Math.max(anchorRect.left + anchorRect.width / 2, POPOVER_CARD_WIDTH / 2 + VIEWPORT_MARGIN),
    window.innerWidth - POPOVER_CARD_WIDTH / 2 - VIEWPORT_MARGIN,
  )
  const top = showBelow ? anchorRect.bottom + 6 : anchorRect.top - 6

  return createPortal(
    <div
      data-tooltip-action-popover
      className="fixed z-50"
      style={{ left, top, transform: `translate(-50%, ${showBelow ? '0' : '-100%'})` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ItemTooltip {...tooltip} />
      <div className="mt-1.5 flex gap-1.5 rounded-lg border border-slate-700 bg-slate-950/95 p-1.5 shadow-xl shadow-black/50">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            className={`flex-1 rounded-md border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
              action.tone === 'warning'
                ? 'border-red-600 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
            }`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
