import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { usePvpDamageToastStore, type PvpDamageToastEntry } from '../../game/pvp/usePvpDamageToastStore'

const TOAST_DISPLAY_MS = 1400

function DamageToastItem({ toast }: { toast: PvpDamageToastEntry }) {
  const dismiss = usePvpDamageToastStore((state) => state.dismiss)

  useEffect(() => {
    const timeout = setTimeout(() => dismiss(toast.id), TOAST_DISPLAY_MS)
    return () => clearTimeout(timeout)
  }, [toast.id, dismiss])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.85 }}
      transition={{ duration: 0.25 }}
      className={`rounded-md border px-3 py-0.5 font-heading text-lg font-black shadow-lg ${
        toast.dealt ? 'border-slate-500 bg-slate-950/90 text-white' : 'border-rose-700 bg-slate-950/90 text-rose-400'
      }`}
      style={{ textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}
    >
      -{toast.amount}
    </motion.div>
  )
}

// Small slide-in/out damage callout (requested by the user after
// playtesting) — white when the active character dealt the hit, red when
// they took it. Deliberately positioned inside the duel card's own content
// bounds (see the parent's `relative` wrapper), not overflowing past its
// edges — this game's `.ascension-card-frame` chamfer is a clip-path, which
// would silently cut off anything positioned outside the frame if this were
// nested where it could overflow (see CLAUDE.md's clip-path gotcha).
export default function PvpDamageToast() {
  const toasts = usePvpDamageToastStore((state) => state.toasts)

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-1">
      <AnimatePresence>
        {toasts.map((toast) => (
          <DamageToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  )
}
