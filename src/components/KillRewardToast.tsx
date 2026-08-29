import { useEffect, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useKillRewardToastStore, type KillRewardToastEntry } from '../game/hud/useKillRewardToastStore'
import { useTabStore } from '../game/hud/useTabStore'
import { useCombatModeStore } from '../game/combat/useCombatModeStore'

const TOAST_DISPLAY_MS = 2200

// Violet, not the app's true `purple` (Ascension Points' own established
// currency color, see CLAUDE.md's guardrail) — same substitution VIP's own
// badge uses for "purple" requests, kept consistent rather than picking a
// second, different "purple" for this toast.
const TOAST_TINT_STYLE = { '--ascension-tint': '#8b5cf6' } as CSSProperties

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
      initial={{ opacity: 0, y: -8, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.9 }}
      transition={{ duration: 0.2 }}
      className="ascension-chip-frame is-tinted shadow-lg will-change-transform"
      style={TOAST_TINT_STYLE}
    >
      <div className="ascension-chip-inner flex items-center gap-2 px-4 py-2 text-sm font-medium">
        {isRare && <span className="shrink-0 leading-none">★</span>}
        {toast.kills > 1 && <span className="text-violet-300">{toast.kills}× kills</span>}
        <span className="text-amber-300">+{toast.gold.toLocaleString()} Gold</span>
        <span className="text-sky-300">+{toast.exp.toLocaleString()} EXP</span>
      </div>
    </motion.div>
  )
}

// Small centered "kill confirmed" toast (see useKillRewardToastStore.ts's own
// comment for the full rationale/timing), dead-centered on screen
// (2026-08-29, requested by the user — was previously top-32) via
// `inset-0 flex items-center justify-center` rather than LevelUpBanner's own
// top-anchored `inset-x-0 top-20`. Uses the app's own tinted chamfered chip
// frame (`.ascension-chip-frame.is-tinted`, see src/index.css) instead of a
// plain rounded-lg/rounded-full pill, matching the "our styling" ask — same
// primitive VIP's own badge uses for its violet tint. pointer-events-none on
// the wrapper, same "never intercepts clicks" precedent as GainToastHost.
// Only rendered while actually viewing the Combat tab's Hunting sub-mode
// (2026-08-29, requested by the user) — a background AFK resolve can still
// fire a toast-worthy response while the player is on another tab entirely
// (Forge, Marketplace, etc.) or on Mining/Events within Combat, which read
// as spammy/irrelevant there. useKillRewardToastStore.show() itself refuses
// to queue a toast while hidden (see its own comment), so nothing can build
// up there — but a toast already showing at the moment the player switches
// away still needs handling: this component unmounts its children
// (`KillRewardToastItem`'s dismiss `setTimeout` is cancelled on unmount),
// which would otherwise leave it stuck in the store to reappear with a full
// fresh timer whenever the player switches back. The effect below clears the
// store outright on that hidden transition instead (2026-08-29, bug fix
// reported by the user — "switched back and the screen was filled with
// them").
export default function KillRewardToast() {
  const toasts = useKillRewardToastStore((state) => state.toasts)
  const clearToasts = useKillRewardToastStore((state) => state.clear)
  const activeTab = useTabStore((state) => state.activeTab)
  const combatMode = useCombatModeStore((state) => state.mode)
  const visible = activeTab === 'combat' && combatMode === 'hunting'

  useEffect(() => {
    if (!visible) clearToasts()
  }, [visible, clearToasts])

  if (!visible) {
    return null
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[75] flex flex-col items-center justify-center gap-1.5 px-4">
      <AnimatePresence>
        {toasts.map((toast) => (
          <KillRewardToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
