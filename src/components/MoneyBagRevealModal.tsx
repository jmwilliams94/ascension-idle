import { useMemo, type CSSProperties } from 'react'
import { useMoneyBagRevealStore } from '../game/items/useMoneyBagRevealStore'
import { GEM_TYPES, getGemIconSrc, getGemTierColor, formatGemTierLabel } from '../game/items/gemTypes'
import { buildRadiateEmbers, seedFromId } from '../game/items/tierEffectsData'

// The center-screen "what did I just open" reveal for a Money Bag/Gem Bag's
// Open action (Lucky Lad rewards expansion, 2026-08-09) — see
// useMoneyBagRevealStore. Mounted unconditionally in GameShell alongside
// OfflineProgressModal/InventoryFullModal, renders nothing when idle.

const GOLD_BURST_COLOR = '#FFD700'
const BURST_EMBER_COUNT = 36
const BURST_RADIUS = 130

interface BurstStyle extends CSSProperties {
  '--ember-dx': string
  '--ember-dy': string
}

// Same per-particle layout math as tierEffects.tsx's ambient TierEmberEffect
// (buildRadiateEmbers), but rendered with the one-shot .effect-ember-burst
// animation (index.css) instead of the infinite .effect-ember-radiate loop —
// a burst that plays once on reveal, not ambient tile decoration.
function GoldEmberBurst({ seed, color }: { seed: number; color: string }) {
  const embers = useMemo(() => buildRadiateEmbers(BURST_EMBER_COUNT, seed, BURST_RADIUS), [seed])

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
        }
        return <span key={i} className="effect-ember-burst absolute rounded-full" style={style} />
      })}
    </div>
  )
}

export default function MoneyBagRevealModal() {
  const reveal = useMoneyBagRevealStore((state) => state.reveal)
  const dismiss = useMoneyBagRevealStore((state) => state.dismiss)

  if (!reveal) {
    return null
  }

  const isGem = reveal.kind === 'gem'
  const color = isGem ? getGemTierColor(reveal.tier) : GOLD_BURST_COLOR
  const seed = seedFromId(isGem ? `gem:${reveal.gemId}:${reveal.tier}` : `gold:${reveal.amount}`)
  const title = isGem ? `${formatGemTierLabel(reveal.tier)} ${GEM_TYPES[reveal.gemId].displayName}` : 'Gold'
  const subtitle = isGem ? `${GEM_TYPES[reveal.gemId].effectLabel} +${GEM_TYPES[reveal.gemId].percentByTier[reveal.tier]}%` : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-6 text-center shadow-2xl shadow-black/60">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">You opened it!</p>

        <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
          <GoldEmberBurst seed={seed} color={color} />
          <div
            className="relative flex h-16 w-16 items-center justify-center rounded-full border-2"
            style={{ borderColor: color, backgroundColor: `${color}22`, boxShadow: `0 0 24px ${color}66` }}
          >
            {isGem ? (
              <img src={getGemIconSrc(reveal.gemId, reveal.tier)} alt="" className="h-4/5 w-4/5 object-contain" />
            ) : (
              <span className="text-3xl">💰</span>
            )}
          </div>
        </div>

        <div>
          <p className="text-lg font-semibold" style={{ color }}>
            {isGem ? title : `${reveal.amount.toLocaleString()} Gold`}
          </p>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-sm font-medium text-sky-300 hover:bg-sky-500/20"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
