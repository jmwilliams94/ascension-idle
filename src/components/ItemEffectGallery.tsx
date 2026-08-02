import type { ReactNode } from 'react'

// Exploratory gallery — a "heap of examples" of animated background effects
// for a gear tile square, requested to compare candidates for the faint
// moving web-like lightning pattern behind Conquer Online's own item icons
// (their version reads as a few layers stacked for depth). NOT wired into
// any real tile yet (InventorySlot, ForgeUpgradeSlot, EquipmentSlot, etc.) —
// this is purely a side-by-side preview so a favorite (or combination) can
// be picked before spending effort on the real integration.

// --- Procedural jagged lightning bolts -------------------------------------
// The first pass at this gallery used smooth Perlin-noise "veins" and clean
// straight connector lines for the web-style examples — the user's own
// reference screenshot made clear neither reads as actual lightning: real
// bolts are jagged/fractal with branching forks, not smooth or straight.
// This is the standard "midpoint displacement" technique for a fractal bolt:
// recursively bend the midpoint of a segment sideways by a shrinking random
// amount. A tiny seeded PRNG (mulberry32) keeps every bolt's jaggedness
// deterministic across renders (no re-layout jitter) while still looking
// organically irregular from bolt to bolt.
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

interface Point {
  x: number
  y: number
}

function jaggedSegment(a: Point, b: Point, rand: () => number, depth: number, displace: number, out: Point[]): void {
  if (depth <= 0) {
    out.push(b)
    return
  }
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  // Perpendicular to the segment, so the displacement bends the bolt
  // sideways rather than along its own length.
  const nx = -dy / len
  const ny = dx / len
  const offset = (rand() - 0.5) * 2 * displace
  const mid: Point = { x: mx + nx * offset, y: my + ny * offset }
  jaggedSegment(a, mid, rand, depth - 1, displace * 0.55, out)
  jaggedSegment(mid, b, rand, depth - 1, displace * 0.55, out)
}

// Returns an SVG path `d` string for a jagged fractal bolt from a to b.
function lightningPath(a: Point, b: Point, seed: number, depth = 4, displace = 13): string {
  const rand = mulberry32(seed)
  const points: Point[] = [a]
  jaggedSegment(a, b, rand, depth, displace, points)
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

interface Bolt {
  d: string
  width: number
}

// Staggered, fast, irregular opacity keyframes (not a slow smooth fade) —
// real electrical arcs strobe, they don't breathe. Cycled across bolts with
// different durations/start delays so a multi-bolt web never looks
// synchronized.
const FLICKERS = [
  '0.15;0.9;0.3;1;0.1;0.8;0.15',
  '0.8;0.2;1;0.15;0.7;0.25;0.8',
  '0.3;1;0.15;0.85;0.2;1;0.3',
  '1;0.2;0.9;0.1;1;0.3;1',
  '0.5;0.95;0.1;0.7;0.4;1;0.5',
  '0.9;0.15;0.6;1;0.05;0.8;0.9',
]

// Renders a set of bolts, optionally with a blurred "glow" pass behind the
// crisp core stroke — the classic neon-sign trick (wide blurred duplicate +
// thin sharp duplicate on top) that's what actually sells "electric" rather
// than just "a thin line."
function BoltLayer({
  bolts,
  color,
  glowFilterId,
  coreOpacity = 1,
  glowOpacity = 0.6,
  flickerOffset = 0,
}: {
  bolts: Bolt[]
  color: string
  glowFilterId?: string
  coreOpacity?: number
  glowOpacity?: number
  flickerOffset?: number
}) {
  return (
    <>
      {glowFilterId && (
        <g stroke={color} fill="none" strokeLinecap="round" filter={`url(#${glowFilterId})`}>
          {bolts.map((bolt, i) => (
            <path key={`glow-${i}`} d={bolt.d} strokeWidth={bolt.width * 3} opacity={glowOpacity}>
              <animate
                attributeName="opacity"
                values={FLICKERS[(i + flickerOffset) % FLICKERS.length]}
                dur={`${0.6 + i * 0.13}s`}
                begin={`${i * 0.11}s`}
                repeatCount="indefinite"
              />
            </path>
          ))}
        </g>
      )}
      <g stroke={color} fill="none" strokeLinecap="round">
        {bolts.map((bolt, i) => (
          <path key={`core-${i}`} d={bolt.d} strokeWidth={bolt.width} opacity={coreOpacity}>
            <animate
              attributeName="opacity"
              values={FLICKERS[(i + flickerOffset) % FLICKERS.length]}
              dur={`${0.6 + i * 0.13}s`}
              begin={`${i * 0.11}s`}
              repeatCount="indefinite"
            />
          </path>
        ))}
      </g>
    </>
  )
}

// A primary criss-crossing web — 4 bolts each running corner-to-corner-ish,
// so they all pass near the tile's center and visibly interconnect rather
// than reading as separate unrelated lines.
const WEB_BOLTS: Bolt[] = [
  { d: lightningPath({ x: 4, y: 6 }, { x: 94, y: 90 }, 11, 4, 12), width: 0.9 },
  { d: lightningPath({ x: 92, y: 8 }, { x: 6, y: 84 }, 27, 4, 12), width: 0.8 },
  { d: lightningPath({ x: 50, y: 3 }, { x: 44, y: 97 }, 53, 3, 9), width: 0.7 },
  { d: lightningPath({ x: 3, y: 50 }, { x: 97, y: 46 }, 71, 3, 9), width: 0.7 },
]

// A denser web (6 main bolts) plus 3 short branch forks stemming from
// midpoints of the main bolts — actual lightning branches off its own path,
// which none of the first-pass examples had at all.
const DENSE_BOLTS: Bolt[] = [
  ...WEB_BOLTS,
  { d: lightningPath({ x: 10, y: 92 }, { x: 88, y: 10 }, 5, 4, 11), width: 0.7 },
  { d: lightningPath({ x: 90, y: 92 }, { x: 12, y: 12 }, 19, 4, 11), width: 0.6 },
]
const BRANCH_BOLTS: Bolt[] = [
  { d: lightningPath({ x: 49, y: 45 }, { x: 78, y: 58 }, 101, 2, 8), width: 0.5 },
  { d: lightningPath({ x: 46, y: 50 }, { x: 22, y: 68 }, 202, 2, 8), width: 0.5 },
  { d: lightningPath({ x: 55, y: 42 }, { x: 65, y: 18 }, 303, 2, 7), width: 0.5 },
]

// A dimmer, smaller-scale, more blurred set for the back layer of the
// "Layered" example — WEB_BOLTS reused as the crisp front layer on top of it,
// giving the actual "a few layered on top of each other" depth requested.
const BACK_BOLTS: Bolt[] = [
  { d: lightningPath({ x: 20, y: 15 }, { x: 80, y: 88 }, 401, 3, 8), width: 0.6 },
  { d: lightningPath({ x: 84, y: 22 }, { x: 16, y: 82 }, 512, 3, 8), width: 0.6 },
]

function SampleTile({ border, layer }: { border: string; layer: ReactNode }) {
  return (
    <div
      className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 bg-slate-900 text-xl"
      style={{ borderColor: border }}
    >
      {layer}
      <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">🗡️</span>
    </div>
  )
}

interface EffectExample {
  title: string
  description: string
  border: string
  layer: ReactNode
}

const EFFECTS: EffectExample[] = [
  {
    title: '1. Lightning Web',
    description: 'Actual jagged fractal bolts (midpoint-displacement, not smooth noise) crossing near the center, each strobing independently, with a soft glow behind the crisp line.',
    border: '#4FC3F7',
    layer: (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="glow1" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.3" />
          </filter>
        </defs>
        <BoltLayer bolts={WEB_BOLTS} color="#a5f3fc" glowFilterId="glow1" />
      </svg>
    ),
  },
  {
    title: '2. Layered Web (Depth)',
    description:
      'Two full bolt layers stacked — a dim, blurred, smaller-scale set behind, a crisp bright set in front — exactly the "a few layered on top of each other" depth from your reference.',
    border: '#A855F7',
    layer: (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="glow2back" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <filter id="glow2front" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1" />
          </filter>
        </defs>
        <BoltLayer bolts={BACK_BOLTS} color="#c4b5fd" glowFilterId="glow2back" coreOpacity={0.35} glowOpacity={0.3} flickerOffset={2} />
        <BoltLayer bolts={WEB_BOLTS} color="#e0f2fe" glowFilterId="glow2front" coreOpacity={1} glowOpacity={0.6} />
      </svg>
    ),
  },
  {
    title: '3. Dense Branching Web',
    description: '6 main bolts plus small forking branches stemming off them mid-path — a busier, more chaotic net, closer to a real lightning strike\'s side-branches.',
    border: '#EF4444',
    layer: (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="glow3" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
        </defs>
        <BoltLayer bolts={DENSE_BOLTS} color="#fca5a5" glowFilterId="glow3" glowOpacity={0.5} />
        <BoltLayer bolts={BRANCH_BOLTS} color="#fecaca" coreOpacity={0.8} flickerOffset={3} />
      </svg>
    ),
  },
  {
    title: '4. Web + Pulsing Core',
    description: 'A soft pulsing radial glow at the center combined with a faint static lightning web overlay — two different techniques literally layered on top of each other.',
    border: '#2E5EAA',
    layer: (
      <>
        <div
          className="effect-blob-1 absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-400/35 blur-lg mix-blend-screen"
          style={{ animationDuration: '2.4s' }}
        />
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full opacity-80">
          <defs>
            <filter id="glow4" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1" />
            </filter>
          </defs>
          <BoltLayer bolts={WEB_BOLTS} color="#bae6fd" glowFilterId="glow4" coreOpacity={0.75} glowOpacity={0.4} />
        </svg>
      </>
    ),
  },
  {
    title: '5. Rotating Energy Sweep',
    description: 'Two conic-gradient beams counter-rotating at different speeds, masked to a soft circle — reads as circling electric current, no SVG lines at all.',
    border: '#FFFFFF',
    layer: (
      <div className="absolute inset-0">
        <div
          className="effect-sweep-a absolute -inset-4"
          style={{
            background: 'conic-gradient(from 0deg, transparent 0deg, rgba(125,211,252,0.6) 20deg, transparent 60deg, transparent 360deg)',
            maskImage: 'radial-gradient(circle, black 55%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(circle, black 55%, transparent 80%)',
          }}
        />
        <div
          className="effect-sweep-b absolute -inset-4"
          style={{
            background: 'conic-gradient(from 180deg, transparent 0deg, rgba(196,181,253,0.45) 25deg, transparent 70deg, transparent 360deg)',
            maskImage: 'radial-gradient(circle, black 55%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(circle, black 55%, transparent 80%)',
          }}
        />
      </div>
    ),
  },
  {
    title: '6. Scrolling Hatch Grid',
    description: 'Two diagonal hairline grids sliding in opposite directions — a cheap, very performant "energy netting" look, no SVG or blur.',
    border: '#4FC3F7',
    layer: (
      <div className="absolute inset-0 opacity-60">
        <div
          className="effect-hatch-a absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(56,189,248,0.4) 0px, rgba(56,189,248,0.4) 1px, transparent 1px, transparent 10px)',
          }}
        />
        <div
          className="effect-hatch-b absolute inset-0 mix-blend-screen"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-45deg, rgba(167,139,250,0.35) 0px, rgba(167,139,250,0.35) 1px, transparent 1px, transparent 10px)',
          }}
        />
      </div>
    ),
  },
  {
    title: '7. Aurora Depth Blobs',
    description: 'Three blurred glow blobs drifting independently, blur amount varying per blob to fake near/far depth — softer and less literal, more "magic aura" than lightning.',
    border: '#A855F7',
    layer: (
      <div className="absolute inset-0 overflow-hidden">
        <div className="effect-blob-1 absolute left-1/4 top-1/4 h-14 w-14 rounded-full bg-sky-400/40 blur-md mix-blend-screen" />
        <div className="effect-blob-2 absolute right-1/4 top-1/3 h-12 w-12 rounded-full bg-purple-400/35 blur-lg mix-blend-screen" />
        <div className="effect-blob-3 absolute bottom-2 left-1/3 h-10 w-10 rounded-full bg-amber-300/30 blur-sm mix-blend-screen" />
      </div>
    ),
  },
]

export default function ItemEffectGallery() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Exploratory only — none of these are wired into real Inventory/Equipment/Forge tiles yet. Effects 1-4 are all built from
        the same procedural jagged-lightning-bolt generator (proper fractal midpoint-displacement, not smooth noise), just
        combined differently. Pick a favorite (or ask for a combination) and it can be built into the real gear slots next,
        likely tinted per quality tier.
      </p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {EFFECTS.map((effect) => (
          <div key={effect.title} className="flex flex-col items-center gap-2 text-center">
            <SampleTile border={effect.border} layer={effect.layer} />
            <p className="text-[11px] font-medium text-slate-300">{effect.title}</p>
            <p className="text-[10px] leading-snug text-slate-500">{effect.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
