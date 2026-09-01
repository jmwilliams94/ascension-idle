import { useEffect, useMemo, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSalvageRevealStore } from '../game/items/useSalvageRevealStore'
import { buildConfettiEmbers } from '../game/items/tierEffectsData'

// Center-screen "+N Ascension Points" reveal for a Salvage result
// (2026-08-13, requested by the user — previously a generic top-right
// GainToastHost toast). Modeled on MoneyBagRevealModal's own center-screen
// reveal, but with less padding around the text (per the user's explicit
// "it doesn't need as much padding... like the money bag does") and a
// "confetti" ember burst — bursts outward then trickles downward via
// .effect-ember-confetti (index.css/buildConfettiEmbers) — instead of
// MoneyBagRevealModal's burst-and-fade-in-place embers.
const REVEAL_DISPLAY_MS = 2400
const SALVAGE_COLOR = '#a855f7'
const CONFETTI_EMBER_COUNT = 24
const AP_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/ascension-points.webp`

interface ConfettiStyle extends CSSProperties {
  '--ember-dx': string
  '--ember-dy': string
  '--ember-fall': string
}

function ConfettiBurst({ seed }: { seed: number }) {
  const embers = useMemo(() => buildConfettiEmbers(CONFETTI_EMBER_COUNT, seed), [seed])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible">
      {embers.map((ember, i) => {
        const style: ConfettiStyle = {
          left: '50%',
          top: '50%',
          width: `${ember.size + 2}px`,
          height: `${ember.size + 2}px`,
          backgroundColor: SALVAGE_COLOR,
          boxShadow: `0 0 ${ember.size + 4}px ${Math.max(1, ember.size)}px ${SALVAGE_COLOR}cc`,
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

// A numeric seed derived from the reveal's own unique id, so a repeated
// same-amount salvage still gets a freshly laid-out burst.
function seedFromRevealId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return h === 0 ? 1 : h
}

// Mounted unconditionally in GameShell, alongside MoneyBagRevealModal.
export default function SalvageRevealToast() {
  const reveal = useSalvageRevealStore((state) => state.reveal)
  const dismiss = useSalvageRevealStore((state) => state.dismiss)

  useEffect(() => {
    if (!reveal) {
      return
    }
    const timeout = setTimeout(dismiss, REVEAL_DISPLAY_MS)
    return () => clearTimeout(timeout)
  }, [reveal, dismiss])

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <AnimatePresence>
        {reveal && (
          <motion.div
            key={reveal.id}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.25 }}
            className="relative flex items-center gap-2 rounded-xl border bg-slate-900/95 px-3 py-1.5 shadow-xl backdrop-blur will-change-transform"
            style={{ borderColor: `${SALVAGE_COLOR}80` }}
          >
            <ConfettiBurst seed={seedFromRevealId(reveal.id)} />
            <img src={AP_ICON_SRC} alt="" className="relative z-10 h-5 w-5 shrink-0 object-contain" />
            <p className="relative z-10 text-sm font-semibold" style={{ color: SALVAGE_COLOR }}>
              +{reveal.amount.toLocaleString()} Ascension Points
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
