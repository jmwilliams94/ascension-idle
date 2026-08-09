import { useEffect, useMemo, type CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMoneyBagRevealStore } from '../game/items/useMoneyBagRevealStore'
import { GEM_TYPES, getGemIconSrc, getGemTierColor, formatGemTierLabel } from '../game/items/gemTypes'
import { buildConfettiEmbers, seedFromId } from '../game/items/tierEffectsData'

// The "what did I just open" reveal for a Money Bag/Gem Bag's Open action
// (Lucky Lad rewards expansion, 2026-08-09) — see useMoneyBagRevealStore.
// Mounted unconditionally in GameShell alongside OfflineProgressModal/
// InventoryFullModal, renders nothing when idle.
//
// Redesigned 2026-08-10 (confirmed with the user) — no longer a full-screen
// blocking modal with a "Got it" button. Now a small floating box, centered
// on screen, that fades in/out on its own (same auto-dismiss idea as
// GainToastHost's top-right toasts, just centered and bigger, with a gold
// ember burst around the box itself instead of a big circular icon frame).
//
// Padding trimmed 2026-08-13 (requested by the user, same pass that added
// SalvageRevealToast's own center reveal) — this card was noticeably
// roomier than it needed to be; not shrunk all the way to
// SalvageRevealToast's own tighter padding since this one still needs to
// fit an optional two-line title+subtitle (gem reveals), not just one line.

const REVEAL_DISPLAY_MS = 2800
const GOLD_BURST_COLOR = '#FFD700'
const BURST_EMBER_COUNT = 28
const BURST_RADIUS = 90

interface BurstStyle extends CSSProperties {
  '--ember-dx': string
  '--ember-dy': string
  '--ember-fall': string
}

// Confetti-style burst (2026-08-13, requested by the user — bring
// SalvageRevealToast's own "bursts out then trickles downward" ember
// physics here too), same coloring as before (gold for a gold reveal, the
// gem's own tier color for a gem reveal) — only the particle motion changed,
// from buildRadiateEmbers/.effect-ember-burst (burst-and-fade-in-place) to
// buildConfettiEmbers/.effect-ember-confetti (index.css).
function EmberBurst({ seed, color }: { seed: number; color: string }) {
  const embers = useMemo(() => buildConfettiEmbers(BURST_EMBER_COUNT, seed, BURST_RADIUS), [seed])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible">
      {embers.map((ember, i) => {
        const style: BurstStyle = {
          left: '50%',
          top: '50%',
          width: `${ember.size + 2}px`,
          height: `${ember.size + 2}px`,
          backgroundColor: color,
          boxShadow: `0 0 ${ember.size + 4}px ${Math.max(1, ember.size)}px ${color}cc`,
          animationDelay: ember.delay,
          animationDuration: ember.duration,
          '--ember-dx': ember.dx,
          '--ember-dy': ember.dy,
          '--ember-fall': ember.fall,
        }
        return <span key={i} className="effect-ember-confetti absolute rounded-full" style={style} />
      })}
    </div>
  )
}

export default function MoneyBagRevealModal() {
  const reveal = useMoneyBagRevealStore((state) => state.reveal)
  const dismiss = useMoneyBagRevealStore((state) => state.dismiss)

  useEffect(() => {
    if (!reveal) {
      return
    }
    const timeout = setTimeout(dismiss, REVEAL_DISPLAY_MS)
    return () => clearTimeout(timeout)
  }, [reveal, dismiss])

  const isGem = reveal?.kind === 'gem'
  const color = !reveal ? undefined : isGem ? getGemTierColor(reveal.tier) : GOLD_BURST_COLOR
  const seed = reveal ? seedFromId(isGem ? `gem:${reveal.gemId}:${reveal.tier}` : `gold:${reveal.amount}`) : 0
  const title = !reveal ? '' : isGem ? `${formatGemTierLabel(reveal.tier)} ${GEM_TYPES[reveal.gemId].displayName}` : 'Gold'
  const subtitle = isGem && reveal.kind === 'gem' ? `${GEM_TYPES[reveal.gemId].effectLabel} +${GEM_TYPES[reveal.gemId].percentByTier[reveal.tier]}%` : null

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <AnimatePresence>
        {reveal && (
          <motion.div
            key={seed}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.25 }}
            className="relative flex items-center gap-2 rounded-xl border bg-slate-900/95 px-3 py-2 shadow-xl backdrop-blur"
            style={{ borderColor: `${color}80` }}
          >
            <EmberBurst seed={seed} color={color as string} />
            <div
              className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2"
              style={{ borderColor: color, backgroundColor: `${color}22` }}
            >
              {isGem && reveal.kind === 'gem' ? (
                <img src={getGemIconSrc(reveal.gemId, reveal.tier)} alt="" className="h-4/5 w-4/5 object-contain" />
              ) : (
                <span className="text-xl">💰</span>
              )}
            </div>
            <div className="relative z-10">
              <p className="text-sm font-semibold" style={{ color }}>
                {reveal.kind === 'gold' ? `${reveal.amount.toLocaleString()} Gold` : title}
              </p>
              {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
