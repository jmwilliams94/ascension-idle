import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Shared modal shell for BankSquares (2026-08-07, confirmed with the user:
// "a popup overlay in the middle of the screen with a more polished/
// professional UI for depositing and withdrawing"), replacing the old
// always-below-the-grid inline panel every square used to reveal. Mirrors
// this codebase's other centered-overlay modals (InventoryFullModal,
// OfflineProgressModal) — fixed backdrop, centered card, ESC/backdrop-click
// to dismiss — rather than the anchored-at-the-tile popovers
// (TooltipActionPopover/GearEquipPopover) used elsewhere, since this is
// explicitly meant to read as a proper dialog, not a quick inline peek.
export default function BankActionModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
