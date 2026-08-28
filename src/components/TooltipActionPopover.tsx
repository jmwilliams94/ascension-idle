import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ItemTooltip from './ItemTooltip'
import { Button } from './ui/Button'
import type { ItemTooltipData } from '../game/items/itemTooltip'
import { clampTooltipLeft, clampTooltipVertical, guessTooltipVertical } from '../lib/tooltipViewportClamp'

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
  if (label.startsWith('Claim') || label.startsWith('Open') || label.startsWith('Bundl')) {
    return 'primary'
  }
  if (label.startsWith('Deposit') || label.startsWith('Bank') || label.startsWith('Stor')) {
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

  const measureRef = useRef<HTMLDivElement>(null)
  const [vertical, setVertical] = useState(() => guessTooltipVertical(anchorRect))

  // Corrects the above/below guess to this popover's real rendered height
  // (tooltip card + button bar) before the browser paints — see
  // tooltipViewportClamp.ts. A tall gear tooltip no longer overflows off the
  // top of the screen just because the anchor tile wasn't close to the edge.
  useLayoutEffect(() => {
    const height = measureRef.current?.getBoundingClientRect().height
    if (height) {
      setVertical(clampTooltipVertical(anchorRect, height))
    }
  }, [anchorRect])

  const left = clampTooltipLeft(anchorRect, POPOVER_CARD_WIDTH)

  // 3-action lists (Bundle/Open + Bank + Bank All, Claim/Store/Sell, ...) put
  // the first action on its own full-width row and split the rest below it
  // — mirrors what 2-action lists (Deposit/Deposit All, Withdraw/Withdraw
  // All) already look like on a single row. Without this, three buttons
  // sharing one flex-wrap row just wrapped each label's own text internally
  // instead of the whole button dropping to a second row (nothing in a plain
  // flex-wrap row forces that split on its own).
  const [firstAction, ...restActions] = actions
  const showFirstActionOnOwnRow = actions.length > 2
  const wrappedRowActions = showFirstActionOnOwnRow ? restActions : actions

  return createPortal(
    <div
      ref={measureRef}
      data-tooltip-action-popover
      className="fixed z-50"
      style={{ left, top: vertical.top, transform: vertical.transform }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ItemTooltip {...tooltip} />
      {/* w-64 — matches ItemTooltip's own fixed width so the button bar's
          edges always line up with the tooltip card above it. */}
      <div className="ascension-chip-frame mt-1.5 w-64 shadow-xl shadow-black/50">
        <div className="ascension-chip-inner flex flex-col gap-1.5 p-1.5">
          {showFirstActionOnOwnRow && (
            <Button variant={actionVariant(firstAction)} disabled={firstAction.disabled} onClick={firstAction.onClick} className="w-full">
              {firstAction.label}
            </Button>
          )}
          <div className="flex flex-wrap gap-1.5">
            {wrappedRowActions.map((action) => (
              <Button key={action.label} variant={actionVariant(action)} disabled={action.disabled} onClick={action.onClick} className="flex-1">
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
