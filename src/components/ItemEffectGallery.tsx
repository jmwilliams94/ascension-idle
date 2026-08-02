import type { CSSProperties } from 'react'

// Item Effects preview — after several rounds of other directions (web/
// lightning line-art, ember clouds, foil sweeps, pulsing glows — see git
// history if any of those are worth resurrecting), the user picked Rising
// Embers as the winner and asked to see it once per quality tier instead of
// as one entry among many unrelated alternatives: colored per tier, and
// denser at higher tiers. Still exploratory — not wired into any real
// Inventory/Equipment/Forge tile yet.

// EmberLayer's per-particle style sets a CSS custom property (--ember-drift)
// alongside normal properties — CSSProperties doesn't type arbitrary custom
// properties, so this extends it rather than reaching for an `any` cast.
interface EmberStyle extends CSSProperties {
  '--ember-drift': string
}

// Tiny deterministic PRNG (mulberry32) so each tier's ember positions/timing
// are organically varied but stable across renders — no layout jitter from
// re-randomizing every render, but also not hand-typed one by one.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface EmberConfig {
  left: string
  size: number
  delay: string
  duration: string
  drift: string
}

// count is the tier's density — higher tiers get more embers (per the
// user's "reduce/increase as the tiers go up" ask). seed just keeps each
// tier's layout looking distinct rather than a shared pattern repeated at
// different counts.
function buildEmbers(count: number, seed: number): EmberConfig[] {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, () => ({
    left: `${(8 + rand() * 84).toFixed(1)}%`,
    size: 2 + Math.round(rand() * 2),
    delay: `${(rand() * 2.6).toFixed(2)}s`,
    duration: `${(2.6 + rand() * 1.3).toFixed(2)}s`,
    drift: `${Math.round((rand() - 0.5) * 22)}px`,
  }))
}

// Small glowing particles rising and fading — see effect-ember-rise in
// index.css. Color is applied via inline style (not a Tailwind class)
// since it's an arbitrary per-tier hex value, not one of a fixed set of
// utility classes Tailwind's build-time scanner could pick up.
function EmberLayer({ embers, color }: { embers: EmberConfig[]; color: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {embers.map((ember, i) => {
        const style: EmberStyle = {
          left: ember.left,
          width: `${ember.size}px`,
          height: `${ember.size}px`,
          backgroundColor: color,
          boxShadow: `0 0 ${ember.size + 3}px ${Math.max(1, ember.size - 1)}px ${color}cc`,
          animationDelay: ember.delay,
          animationDuration: ember.duration,
          '--ember-drift': ember.drift,
        }
        return <span key={i} className="effect-ember absolute bottom-1 rounded-full" style={style} />
      })}
    </div>
  )
}

// Mirrors QUALITY_COLORS/QUALITY_LABELS in equipmentBonus.ts — not imported
// directly since this gallery is meant to stay a standalone, disposable
// preview, but these must stay in sync with that file if either changes.
interface TierExample {
  label: string
  color: string
  count: number
}

const TIERS: TierExample[] = [
  { label: 'Normal', color: '#FFFFFF', count: 3 },
  { label: 'Tempered', color: '#4FC3F7', count: 5 },
  { label: 'Infused', color: '#2E5EAA', count: 7 },
  { label: 'Radiant', color: '#A855F7', count: 10 },
  { label: 'Ascended', color: '#EF4444', count: 14 },
]

function TierTile({ tier, index }: { tier: TierExample; index: number }) {
  const embers = buildEmbers(tier.count, 100 + index * 37)

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div
        className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 bg-slate-900 text-xl"
        style={{ borderColor: tier.color }}
      >
        {/* A faint ambient tint behind the embers, tied to the same tier
            color — consistent with how equipped gear's own border already
            tints per quality tier elsewhere in the game. */}
        <div className="absolute inset-0" style={{ background: `radial-gradient(circle, ${tier.color}22, transparent 70%)` }} />
        <EmberLayer embers={embers} color={tier.color} />
        <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">🗡️</span>
      </div>
      <p className="text-[11px] font-medium text-slate-300">{tier.label}</p>
      <p className="text-[10px] leading-snug text-slate-500">{tier.count} embers</p>
    </div>
  )
}

export default function ItemEffectGallery() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Exploratory only — not wired into any real Inventory/Equipment/Forge tile yet. Rising Embers, once per quality tier:
        colored to match that tier (same hex values as the real quality-tier borders elsewhere in the game), and denser at
        higher tiers — Normal gets a faint trickle, Ascended gets a real flurry. Every tile is actually animated; a screenshot
        won't show the motion.
      </p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {TIERS.map((tier, index) => (
          <TierTile key={tier.label} tier={tier} index={index} />
        ))}
      </div>
    </div>
  )
}
