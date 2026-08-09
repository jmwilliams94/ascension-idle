import type { ReactNode } from 'react'

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
export default function ForgeTwoColumnLayout({ title, onBack, inventory, children }: ForgeTwoColumnLayoutProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500"
        >
          ← Forge
        </button>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>{inventory}</div>
        <div className="flex flex-col items-center gap-6">{children}</div>
      </div>
    </div>
  )
}
