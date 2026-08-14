import type { ReactNode } from 'react'
import { Button } from './ui/Button'

interface ForgeTwoColumnLayoutProps {
  title: string
  onBack: () => void
  inventory: ReactNode
  children: ReactNode
}

// Shared shell for every Forge sub-panel (2026-08-13 redesign — supersedes
// each panel's own centered single column) — a Back button + title row, then
// Inventory on the left and that panel's own controls (upgrade slot(s),
// buttons, previews) on the right, per the user's explicit "inventory on the
// left and the upgrade tiles/layout etc on the right." Stacks vertically
// below `lg`, same responsive breakpoint every other two-column page in this
// app already uses (see ShopPanel.tsx).
//
// Stacked-order fix (2026-08-13, reported by the user — "the inventory is
// sitting at the top of every one of the forge pages"): with no explicit
// order, a stacked grid falls back to DOM order, and Inventory is first in
// the markup — so below `lg` it rendered above the actual upgrade slots,
// which is what you actually want to see/act on first. `order-2`/`order-1`
// below `lg` puts the slots on top while stacked; `lg:order-1`/`lg:order-2`
// restores the untouched inventory-left/slots-right column layout at `lg`+.
export default function ForgeTwoColumnLayout({ title, onBack, inventory, children }: ForgeTwoColumnLayoutProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={onBack}>
          ← Forge
        </Button>
        <h2 className="font-heading text-gradient-steel text-sm font-black uppercase tracking-[0.15em]">{title}</h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="order-2 lg:order-1">{inventory}</div>
        <div className="order-1 flex flex-col items-center gap-6 lg:order-2">{children}</div>
      </div>
    </div>
  )
}
