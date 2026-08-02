import type { CSSProperties, ReactNode } from 'react'

// Item Effects preview — a per-quality-tier look at the Rising Embers effect
// (the winner picked from an earlier, much larger grab-bag of unrelated
// directions — web/lightning line-art, ember clouds, a foil sweep — see git
// history if any of those are worth revisiting). Still exploratory — not
// wired into any real Inventory/Equipment/Forge tile yet.
//
// Normal deliberately gets no effect at all (per the user's "that one
// shouldn't have any" — kept as a labeled baseline tile so the escalation
// from nothing to Ascended's full flurry is visible side by side, not
// dropped from the gallery entirely). Ascended uses the "vibrant core" glow
// variant (brighter, breathing radial glow) as its confirmed real look.
//
// Radiating-from-center overtook rising-from-bottom as the favorite (the
// user's own "I love that one the most" about Ascended's 100-ember
// radiating example) — Tempered/Infused/Radiant each now show both their
// original rising version and a radiating counterpart (5/10/25 embers, the
// user's own picked counts) so all four tiers can be compared in both
// styles before radiating fully replaces rising everywhere.

// Tiny deterministic PRNG (mulberry32) so every tile's ember positions/
// timing are organically varied but stable across renders — no layout
// jitter from re-randomizing every render, but also not hand-typed one by
// one.
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

// EmberLayer's per-particle style sets a CSS custom property alongside
// normal properties — CSSProperties doesn't type arbitrary custom
// properties, so these extend it rather than reaching for an `any` cast.
interface RiseStyle extends CSSProperties {
  '--ember-drift': string
}
interface RadiateStyle extends CSSProperties {
  '--ember-dx': string
  '--ember-dy': string
}

interface RiseEmberConfig {
  left: string
  size: number
  delay: string
  duration: string
  drift: string
}

// count is the tile's density — higher tiers get more embers. seed just
// keeps each tile's layout looking distinct rather than a shared pattern
// repeated at different counts.
function buildRiseEmbers(count: number, seed: number): RiseEmberConfig[] {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, () => ({
    left: `${(8 + rand() * 84).toFixed(1)}%`,
    size: 2 + Math.round(rand() * 2),
    delay: `${(rand() * 2.6).toFixed(2)}s`,
    duration: `${(2.6 + rand() * 1.3).toFixed(2)}s`,
    drift: `${Math.round((rand() - 0.5) * 22)}px`,
  }))
}

// Rising from the bottom and fading near the top — see effect-ember-rise in
// index.css.
function RisingEmberLayer({ embers, color }: { embers: RiseEmberConfig[]; color: string }) {
  return (
    <>
      {embers.map((ember, i) => {
        const style: RiseStyle = {
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
    </>
  )
}

interface RadiateEmberConfig {
  size: number
  delay: string
  duration: string
  dx: string
  dy: string
}

// Each ember launches from the tile's own center outward at a random angle/
// distance, rather than rising from the bottom. `radius` defaults to
// roughly the tile's own half-width (h-24/w-24 = 96px), so embers travel
// out to (and a little past, into the flat edges and corners) the visible
// boundary rather than stopping short in the middle.
function buildRadiateEmbers(count: number, seed: number, radius = 48): RadiateEmberConfig[] {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, () => {
    const angle = rand() * Math.PI * 2
    const distance = radius * (0.75 + rand() * 0.5)
    return {
      size: 2 + Math.round(rand() * 2),
      delay: `${(rand() * 2.2).toFixed(2)}s`,
      duration: `${(1.7 + rand() * 0.9).toFixed(2)}s`,
      dx: `${(Math.cos(angle) * distance).toFixed(1)}px`,
      dy: `${(Math.sin(angle) * distance).toFixed(1)}px`,
    }
  })
}

// Launching from center outward and fading near the edge — see
// effect-ember-radiate in index.css.
function RadiatingEmberLayer({ embers, color }: { embers: RadiateEmberConfig[]; color: string }) {
  return (
    <>
      {embers.map((ember, i) => {
        const style: RadiateStyle = {
          left: '50%',
          top: '50%',
          width: `${ember.size}px`,
          height: `${ember.size}px`,
          backgroundColor: color,
          boxShadow: `0 0 ${ember.size + 3}px ${Math.max(1, ember.size - 1)}px ${color}cc`,
          animationDelay: ember.delay,
          animationDuration: ember.duration,
          '--ember-dx': ember.dx,
          '--ember-dy': ember.dy,
        }
        return <span key={i} className="effect-ember-radiate absolute rounded-full" style={style} />
      })}
    </>
  )
}

// The faint static tint every effect tile gets (tied to the tier's own
// color, matching how equipped gear's own border already tints per quality
// tier elsewhere in the game). `vivid` swaps it for a brighter, breathing
// version, for the "more extravagant" ask — no solid center dot (removed
// per feedback that it read as an odd flat circle rather than part of the
// glow), just a bigger, brighter, breathing radial gradient.
function CoreGlow({ color, vivid = false }: { color: string; vivid?: boolean }) {
  if (!vivid) {
    return <div className="absolute inset-0" style={{ background: `radial-gradient(circle, ${color}22, transparent 70%)` }} />
  }

  return (
    <div
      className="effect-core-pulse absolute inset-0"
      style={{ background: `radial-gradient(circle, ${color}80 0%, ${color}38 40%, transparent 75%)` }}
    />
  )
}

// Mirrors QUALITY_COLORS/QUALITY_LABELS in equipmentBonus.ts — not imported
// directly since this gallery is meant to stay a standalone, disposable
// preview, but these must stay in sync with that file if either changes.
interface Example {
  label: string
  caption: string
  color: string
  layer: ReactNode
}

const EXAMPLES: Example[] = [
  {
    label: 'Normal',
    caption: 'No effect',
    color: '#FFFFFF',
    layer: null,
  },
  {
    label: 'Tempered',
    caption: '4 embers',
    color: '#4FC3F7',
    layer: (
      <>
        <CoreGlow color="#4FC3F7" />
        <RisingEmberLayer embers={buildRiseEmbers(4, 137)} color="#4FC3F7" />
      </>
    ),
  },
  {
    // Radiating became the favorite over rising (per the user's "I love
    // that one the most" about Ascended's 100-ember radiating example) —
    // these three give the same treatment to the other tiers, at counts the
    // user picked (5/10/25), so all four tiers can be compared side by side
    // before deciding whether radiating fully replaces rising.
    label: 'Tempered (Radiating)',
    caption: '5 embers, reaching the tile edge',
    color: '#4FC3F7',
    layer: (
      <>
        <CoreGlow color="#4FC3F7" vivid />
        <RadiatingEmberLayer embers={buildRadiateEmbers(5, 138)} color="#4FC3F7" />
      </>
    ),
  },
  {
    label: 'Infused',
    caption: '7 embers',
    color: '#2E5EAA',
    layer: (
      <>
        <CoreGlow color="#2E5EAA" />
        <RisingEmberLayer embers={buildRiseEmbers(7, 174)} color="#2E5EAA" />
      </>
    ),
  },
  {
    label: 'Infused (Radiating)',
    caption: '10 embers, reaching the tile edge',
    color: '#2E5EAA',
    layer: (
      <>
        <CoreGlow color="#2E5EAA" vivid />
        <RadiatingEmberLayer embers={buildRadiateEmbers(10, 175)} color="#2E5EAA" />
      </>
    ),
  },
  {
    label: 'Radiant',
    caption: '10 embers',
    color: '#A855F7',
    layer: (
      <>
        <CoreGlow color="#A855F7" />
        <RisingEmberLayer embers={buildRiseEmbers(10, 211)} color="#A855F7" />
      </>
    ),
  },
  {
    label: 'Radiant (Radiating)',
    caption: '25 embers, reaching the tile edge',
    color: '#A855F7',
    layer: (
      <>
        <CoreGlow color="#A855F7" vivid />
        <RadiatingEmberLayer embers={buildRadiateEmbers(25, 212)} color="#A855F7" />
      </>
    ),
  },
  {
    // Decided: the vivid/breathing core glow is the real Ascended look now
    // (the earlier plain-glow variant was dropped).
    label: 'Ascended',
    caption: '15 embers, vibrant core glow',
    color: '#EF4444',
    layer: (
      <>
        <CoreGlow color="#EF4444" vivid />
        <RisingEmberLayer embers={buildRiseEmbers(15, 248)} color="#EF4444" />
      </>
    ),
  },
  {
    // The favorite so far, per the user directly — same radiating-from-
    // center idea pushed to an extreme (100 embers, reaching all the way to
    // the tile's edge instead of stopping partway).
    label: 'Ascended (Radiating)',
    caption: '100 embers, reaching the tile edge',
    color: '#EF4444',
    layer: (
      <>
        <CoreGlow color="#EF4444" vivid />
        <RadiatingEmberLayer embers={buildRadiateEmbers(100, 285)} color="#EF4444" />
      </>
    ),
  },
]

function ExampleTile({ example }: { example: Example }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div
        className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 bg-slate-900 text-xl"
        style={{ borderColor: example.color }}
      >
        {example.layer}
        <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">🗡️</span>
      </div>
      <p className="text-[11px] font-medium text-slate-300">{example.label}</p>
      <p className="text-[10px] leading-snug text-slate-500">{example.caption}</p>
    </div>
  )
}

export default function ItemEffectGallery() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Exploratory only — not wired into any real Inventory/Equipment/Forge tile yet. Colored to match each quality tier (same
        hex values as the real quality-tier borders elsewhere in the game). Normal gets no effect at all. Every other tier shows
        both a rising version (embers drift up from the bottom) and a radiating version (embers burst outward from the center
        to the tile's edge) — radiating has become the favorite. Tempered/Infused/Radiant radiate at 5/10/25 embers, Ascended at
        100. Every tile is actually animated; a screenshot won't show the motion.
      </p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {EXAMPLES.map((example) => (
          <ExampleTile key={example.label} example={example} />
        ))}
      </div>
    </div>
  )
}
