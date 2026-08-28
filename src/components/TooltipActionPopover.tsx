import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import ItemTooltip from './ItemTooltip'
import { Button } from './ui/Button'
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

// Maps a generic action to one of Button's three variants, going purely off
// its own label text (this popover is fed arbitrary action lists from many
// call sites — Bank deposit/liquidate, Bundle/Open scroll, Bag Open,
// LootHoldingCard's Claim/Store/Sell — with no per-action "kind" field to
// switch on). `tone: 'warning'` (a destination-is-full signal) always wins
// and maps to danger regardless of label. Prefixes are chosen short enough to
// still match each action's own busy-state label (e.g. "Selling…" still
// starts with "Sell", "Storing…" still starts with "Stor") — see each
// caller's dynamic label strings.
function actionVariant(action: TooltipActionPopoverAction): 'primary' | 'secondary' | 'danger' {
  if (action.tone === 'warning') {
    return 'danger'
  }
  const label = action.label
  if (label.startsWith('Sell')) {
    return 'danger'
  }
  if (label.startsWith('Claim') || label.startsWith('Open')) {
    return 'primary'
  }
  if (label.startsWith('Deposit') || label.startsWith('Bank') || label.startsWith('Stor') || label.startsWith('Bundl')) {
    return 'secondary'
  }
  return 'primary'
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
      <div className="ascension-chip-frame mt-1.5 shadow-xl shadow-black/50">
        <div className="ascension-chip-inner flex flex-wrap gap-1.5 p-1.5">
          {actions.map((action) => (
            <Button key={action.label} variant={actionVariant(action)} disabled={action.disabled} onClick={action.onClick} className="flex-1">
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
