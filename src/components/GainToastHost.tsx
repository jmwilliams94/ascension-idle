import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGainToastStore, type GainToastEntry } from '../game/hud/useGainToastStore'

const TOAST_DISPLAY_MS = 2400

function GainToastItem({ toast }: { toast: GainToastEntry }) {
  const dismiss = useGainToastStore((state) => state.dismiss)

  useEffect(() => {
    const timeout = setTimeout(() => dismiss(toast.id), TOAST_DISPLAY_MS)
    return () => clearTimeout(timeout)
  }, [toast.id, dismiss])

  const color = toast.color ?? '#fbbf24'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2 rounded-lg border bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-slate-100 shadow-lg backdrop-blur will-change-transform"
      style={{ borderColor: `${color}80` }}
    >
      {toast.iconSrc ? (
        <img src={toast.iconSrc} alt="" className="h-4 w-4 shrink-0 object-contain" />
      ) : toast.icon ? (
        <span className="shrink-0 text-sm leading-none">{toast.icon}</span>
      ) : null}
      <span style={{ color }}>+{toast.amount.toLocaleString()}</span>
      <span className="text-slate-300">{toast.label}</span>
    </motion.div>
  )
}

// Mounted once, unconditionally, in GameShell — a fixed top-right stack
// (clears the header/ExpBar strip, and stays clear of MobileBottomNav's own
// fixed bottom bar on mobile) so a gain reads as confirmed no matter which
// tab triggered it. pointer-events-none on the wrapper so the toasts never
// intercept clicks on whatever's underneath; each toast re-enables pointer
// events on itself only if it ever needs interaction later (it doesn't yet).
export default function GainToastHost() {
  const toasts = useGainToastStore((state) => state.toasts)

  return (
    <div className="pointer-events-none fixed right-3 top-20 z-40 flex flex-col items-end gap-2 lg:top-16">
      <AnimatePresence>
        {toasts.map((toast) => (
          <GainToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  )
}
