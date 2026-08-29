import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useKillRewardToastStore, type KillRewardToastEntry } from '../game/hud/useKillRewardToastStore'

const TOAST_DISPLAY_MS = 2200

function KillRewardToastItem({ toast }: { toast: KillRewardToastEntry }) {
  const dismiss = useKillRewardToastStore((state) => state.dismiss)

  useEffect(() => {
    const timeout = setTimeout(() => dismiss(toast.id), TOAST_DISPLAY_MS)
    return () => clearTimeout(timeout)
  }, [toast.id, dismiss])

  const isRare = toast.rareKills > 0

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium shadow-lg backdrop-blur will-change-transform ${
        isRare ? 'border-fuchsia-400/60 bg-fuchsia-400/10' : 'border-slate-700 bg-slate-900/95'
      }`}
    >
      {isRare && <span className="shrink-0 text-sm leading-none">★</span>}
      {toast.kills > 1 && <span className="text-slate-400">{toast.kills}× kills</span>}
      <span className="text-amber-300">+{toast.gold.toLocaleString()} Gold</span>
      <span className="text-sky-300">+{toast.exp.toLocaleString()} EXP</span>
    </motion.div>
  )
}

// Small centered "kill confirmed" toast (see useKillRewardToastStore.ts's own
// comment for the full rationale/timing) — a portaled, fixed overlay so it
// reads the same no matter which tab triggered it, positioned below
// LevelUpBanner's own top-20 slot so the two never overlap if a level-up and
// a kill grant land in the same instant. pointer-events-none on the wrapper,
// same "never intercepts clicks" precedent as GainToastHost.
export default function KillRewardToast() {
  const toasts = useKillRewardToastStore((state) => state.toasts)

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-32 z-[75] flex flex-col items-center gap-1.5 px-4">
      <AnimatePresence>
        {toasts.map((toast) => (
          <KillRewardToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
