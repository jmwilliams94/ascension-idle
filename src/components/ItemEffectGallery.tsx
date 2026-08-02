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

// RADIAL_BOLTS: a single-strike burst — every bolt passes near the tile's
// center, radiating outward like a bolt hit the item dead-on. A legitimate
// lightning look on its own, but structurally it's a "starburst," not a
// "web" — every line shares one hub point. Kept as its own distinct example
// (1) rather than the base every other example reuses, since reusing it
// everywhere is exactly what made 1/2/3/4 all look nearly identical last
// round (same shape, only color/blur/pulse differed — invisible in a static
// screenshot).
const RADIAL_BOLTS: Bolt[] = [
  { d: lightningPath({ x: 4, y: 6 }, { x: 94, y: 90 }, 11, 4, 12), width: 0.9 },
  { d: lightningPath({ x: 92, y: 8 }, { x: 6, y: 84 }, 27, 4, 12), width: 0.8 },
  { d: lightningPath({ x: 50, y: 3 }, { x: 44, y: 97 }, 53, 3, 9), width: 0.7 },
  { d: lightningPath({ x: 3, y: 50 }, { x: 97, y: 46 }, 71, 3, 9), width: 0.7 },
]

// MESH_BOLTS: the actual fix for "doesn't look like a web" — 7 scattered
// node points connected pairwise, so the bolts cross at several different
// points spread across the tile instead of all converging on one center hub.
// This is what a real spiderweb/net structurally is that RADIAL_BOLTS above
// isn't.
const MESH_NODES = {
  a: { x: 15, y: 20 },
  b: { x: 58, y: 8 },
  c: { x: 88, y: 18 },
  d: { x: 78, y: 32 },
  e: { x: 28, y: 68 },
  f: { x: 18, y: 88 },
  g: { x: 62, y: 92 },
}
const MESH_BOLTS: Bolt[] = [
  { d: lightningPath(MESH_NODES.a, MESH_NODES.d, 601, 3, 9), width: 0.7 },
  { d: lightningPath(MESH_NODES.b, MESH_NODES.e, 602, 3, 9), width: 0.7 },
  { d: lightningPath(MESH_NODES.c, MESH_NODES.f, 603, 4, 10), width: 0.7 },
  { d: lightningPath(MESH_NODES.d, MESH_NODES.g, 604, 3, 8), width: 0.6 },
  { d: lightningPath(MESH_NODES.e, MESH_NODES.f, 605, 2, 7), width: 0.6 },
  { d: lightningPath(MESH_NODES.b, MESH_NODES.d, 606, 2, 6), width: 0.6 },
  { d: lightningPath(MESH_NODES.a, MESH_NODES.e, 607, 2, 7), width: 0.6 },
]

// Small forks stemming off two of the mesh's own nodes — real lightning
// branches off its own path, which nothing in the first pass had at all.
const BRANCH_BOLTS: Bolt[] = [
  { d: lightningPath(MESH_NODES.d, { x: 95, y: 55 }, 701, 2, 7), width: 0.45 },
  { d: lightningPath(MESH_NODES.e, { x: 8, y: 45 }, 702, 2, 7), width: 0.45 },
  { d: lightningPath(MESH_NODES.b, { x: 40, y: 2 }, 703, 2, 6), width: 0.45 },
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
    title: '1. Radial Strike',
    description:
      'A single-strike burst — every bolt radiates outward from near the center. Reads as lightning, but structurally it\'s a "starburst" (one shared hub), not a web.',
    border: '#4FC3F7',
    layer: (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="glow1" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.3" />
          </filter>
        </defs>
        <BoltLayer bolts={RADIAL_BOLTS} color="#a5f3fc" glowFilterId="glow1" />
      </svg>
    ),
  },
  {
    title: '2. Mesh Web',
    description:
      'The actual structural fix for "web" — 7 scattered points connected pairwise, crossing at several different spots instead of one center. This is what a real net looks like, not a burst.',
    border: '#A855F7',
    layer: (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="glow2" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>
        <BoltLayer bolts={MESH_BOLTS} color="#e9d5ff" glowFilterId="glow2" />
      </svg>
    ),
  },
  {
    title: '3. Layered Web (Depth)',
    description:
      'Two genuinely different patterns overlapping — a dim, blurred Radial Strike rotated behind a crisp Mesh Web in front — real depth from two distinct shapes, not the same shape twice.',
    border: '#EF4444',
    layer: (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="glow3back" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
          <filter id="glow3front" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1" />
          </filter>
        </defs>
        <g transform="rotate(22 50 50)">
          <BoltLayer bolts={RADIAL_BOLTS} color="#fca5a5" glowFilterId="glow3back" coreOpacity={0.3} glowOpacity={0.25} flickerOffset={2} />
        </g>
        <BoltLayer bolts={MESH_BOLTS} color="#fee2e2" glowFilterId="glow3front" coreOpacity={1} glowOpacity={0.6} />
      </svg>
    ),
  },
  {
    title: '4. Dense Branching Mesh',
    description: 'The Mesh Web plus small forks stemming off two of its own nodes — a busier, more chaotic net, closer to a real lightning strike\'s side-branches.',
    border: '#2E5EAA',
    layer: (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="glow4" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
        </defs>
        <BoltLayer bolts={MESH_BOLTS} color="#bae6fd" glowFilterId="glow4" glowOpacity={0.5} />
        <BoltLayer bolts={BRANCH_BOLTS} color="#dbeafe" coreOpacity={0.8} flickerOffset={3} />
      </svg>
    ),
  },
  {
    title: '5. Web + Pulsing Core',
    description: 'A soft pulsing radial glow at the center combined with the faint Mesh Web — two different techniques literally layered on top of each other.',
    border: '#FFFFFF',
    layer: (
      <>
        <div
          className="effect-blob-1 absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-400/45 blur-lg mix-blend-screen"
          style={{ animationDuration: '2.4s' }}
        />
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full opacity-80">
          <defs>
            <filter id="glow5" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1" />
            </filter>
          </defs>
          <BoltLayer bolts={MESH_BOLTS} color="#bae6fd" glowFilterId="glow5" coreOpacity={0.75} glowOpacity={0.4} />
        </svg>
      </>
    ),
  },
  {
    title: '6. Rotating Energy Sweep',
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
    title: '7. Scrolling Hatch Grid',
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
    title: '8. Aurora Depth Blobs',
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
        Exploratory only — none of these are wired into real Inventory/Equipment/Forge tiles yet. Effects 1-5 share the same
        jagged-bolt generator but are now built from two structurally different base shapes — Radial Strike (1, every bolt
        shares one center hub) and Mesh Web (2, scattered crossing points, no hub) — combined differently, so they should
        actually look distinct now instead of just recolored. Pick a favorite (or ask for a combination) and it can be built
        into the real gear slots next, likely tinted per quality tier.
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
