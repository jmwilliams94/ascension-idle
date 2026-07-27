import type { ReactNode } from 'react'

// Shared chrome for panels that appear as an overlay on top of GameCanvas (Shop,
// Zone, Equipment, Forge, Marketplace — see useOverlayStore) — absolutely
// positioned within GameShell's relative wrapper, closable via an X. BottomNav stays
// visible/usable underneath rather than being replaced.
export default function OverlayPanel({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col rounded-3xl border border-slate-800 bg-slate-950/95 p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-200">{title}</p>
        <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="text-slate-400 hover:text-slate-200">
          ✕
        </button>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
