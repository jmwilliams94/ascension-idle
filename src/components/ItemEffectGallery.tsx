import type { ReactNode } from 'react'

// Exploratory gallery — a "heap of examples" of animated background effects
// for a gear tile square, requested to compare candidates for the faint
// moving web-like lightning pattern behind Conquer Online's own item icons
// (their version reads as a few layers stacked for depth). NOT wired into
// any real tile yet (InventorySlot, ForgeUpgradeSlot, EquipmentSlot, etc.) —
// this is purely a side-by-side preview so a favorite (or combination) can
// be picked before spending effort on the real integration.
interface EffectExample {
  title: string
  description: string
  border: string
  layer: ReactNode
}

// One shared sample icon per tile so every example is judged on the same
// footing — a plain emoji stand-in, not tied to any real item art.
function SampleTile({ border, layer }: { border: string; layer: ReactNode }) {
  return (
    <div
      className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 bg-slate-900 text-xl"
      style={{ borderColor: border }}
    >
      {layer}
      <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">🗡️</span>
    </div>
  )
}

const EFFECTS: EffectExample[] = [
  {
    title: '1. Fractal Web',
    description: 'A single layer of animated Perlin noise, filtered down to thin glowing veins — a slow, drifting cobweb of light.',
    border: '#4FC3F7',
    layer: (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full opacity-70 mix-blend-screen">
        <defs>
          <filter id="fw1" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.03 0.09" numOctaves={2} seed={4} result="n">
              <animate attributeName="baseFrequency" dur="16s" values="0.03 0.09;0.05 0.05;0.03 0.09" repeatCount="indefinite" />
            </feTurbulence>
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.85  0 0 0 0 1  0 0 0 10 -4.2" />
          </filter>
        </defs>
        <rect width="100" height="100" filter="url(#fw1)" />
      </svg>
    ),
  },
  {
    title: '2. Layered Web (Depth)',
    description:
      'Two independent noise layers — one slow/coarse, one fast/fine, both screen-blended — stacked for exactly the "a few layered on top of each other" depth you described.',
    border: '#A855F7',
    layer: (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="fw2a" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.025 0.07" numOctaves={2} seed={1} result="n">
              <animate attributeName="baseFrequency" dur="22s" values="0.025 0.07;0.04 0.04;0.025 0.07" repeatCount="indefinite" />
            </feTurbulence>
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.6  0 0 0 0 0.4  0 0 0 0 1  0 0 0 9 -3.6" />
          </filter>
          <filter id="fw2b" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.09 0.18" numOctaves={2} seed={9} result="n2">
              <animate attributeName="baseFrequency" dur="9s" values="0.09 0.18;0.15 0.1;0.09 0.18" repeatCount="indefinite" />
            </feTurbulence>
            <feColorMatrix in="n2" type="matrix" values="0 0 0 0 0.8  0 0 0 0 0.9  0 0 0 0 1  0 0 0 11 -4.6" />
          </filter>
        </defs>
        <rect width="100" height="100" filter="url(#fw2a)" opacity={0.55} className="mix-blend-screen" />
        <rect width="100" height="100" filter="url(#fw2b)" opacity={0.35} className="mix-blend-screen" />
      </svg>
    ),
  },
  {
    title: '3. Crackling Web Lines',
    description:
      'Hand-drawn jagged connections between a handful of points, each segment flickering on its own independent timer — the most literal "web/lightning" reading.',
    border: '#EF4444',
    layer: (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full opacity-90">
        <g stroke="#7dd3fc" strokeWidth={0.7} fill="none" strokeLinecap="round">
          <path d="M10,15 L35,30 L60,12 L88,25">
            <animate attributeName="opacity" values="0.15;0.9;0.2;0.7;0.15" dur="3.4s" repeatCount="indefinite" />
          </path>
          <path d="M15,55 L40,42 L65,60 L85,48">
            <animate attributeName="opacity" values="0.8;0.2;0.9;0.15;0.8" dur="2.7s" begin="0.4s" repeatCount="indefinite" />
          </path>
          <path d="M35,30 L40,42">
            <animate attributeName="opacity" values="0.9;0.1;0.9" dur="1.6s" begin="0.9s" repeatCount="indefinite" />
          </path>
          <path d="M60,12 L65,60">
            <animate attributeName="opacity" values="0.2;0.9;0.2" dur="2.1s" begin="0.2s" repeatCount="indefinite" />
          </path>
          <path d="M10,15 L15,55">
            <animate attributeName="opacity" values="0.6;0.1;0.7;0.2" dur="3.9s" begin="1.1s" repeatCount="indefinite" />
          </path>
          <path d="M88,25 L85,48">
            <animate attributeName="opacity" values="0.3;0.85;0.25" dur="2.4s" begin="0.6s" repeatCount="indefinite" />
          </path>
        </g>
      </svg>
    ),
  },
  {
    title: '4. Rotating Energy Sweep',
    description: 'Two conic-gradient beams counter-rotating at different speeds, masked to a soft circle — reads as circling electric current, no SVG needed.',
    border: '#2E5EAA',
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
    title: '5. Scrolling Hatch Grid',
    description: 'Two diagonal hairline grids sliding in opposite directions — a cheap, very performant "energy netting" look, no SVG or blur.',
    border: '#FFFFFF',
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
    title: '6. Aurora Depth Blobs',
    description: 'Three blurred glow blobs drifting independently, blur amount varying per blob to fake near/far depth — softer and less literal, more "magic aura."',
    border: '#A855F7',
    layer: (
      <div className="absolute inset-0 overflow-hidden">
        <div className="effect-blob-1 absolute left-1/4 top-1/4 h-14 w-14 rounded-full bg-sky-400/40 blur-md mix-blend-screen" />
        <div className="effect-blob-2 absolute right-1/4 top-1/3 h-12 w-12 rounded-full bg-purple-400/35 blur-lg mix-blend-screen" />
        <div className="effect-blob-3 absolute bottom-2 left-1/3 h-10 w-10 rounded-full bg-amber-300/30 blur-sm mix-blend-screen" />
      </div>
    ),
  },
  {
    title: '7. Neural Web Nodes',
    description: 'Fixed node points connected by lines, each connection pulsing independently — closer to a literal spiderweb/circuit than free-flowing noise.',
    border: '#4FC3F7',
    layer: (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full opacity-90">
        <circle cx={20} cy={20} r={2} fill="#67e8f9" />
        <circle cx={55} cy={15} r={2} fill="#67e8f9" />
        <circle cx={80} cy={35} r={2} fill="#67e8f9" />
        <circle cx={30} cy={55} r={2} fill="#67e8f9" />
        <circle cx={65} cy={65} r={2} fill="#67e8f9" />
        <circle cx={15} cy={80} r={2} fill="#67e8f9" />
        <circle cx={85} cy={80} r={2} fill="#67e8f9" />
        <line x1={20} y1={20} x2={55} y2={15} stroke="#67e8f9" strokeWidth={0.6}>
          <animate attributeName="opacity" values="0.1;0.8;0.1" dur="2.2s" repeatCount="indefinite" />
        </line>
        <line x1={55} y1={15} x2={80} y2={35} stroke="#67e8f9" strokeWidth={0.6}>
          <animate attributeName="opacity" values="0.7;0.1;0.7" dur="3.1s" begin="0.3s" repeatCount="indefinite" />
        </line>
        <line x1={20} y1={20} x2={30} y2={55} stroke="#67e8f9" strokeWidth={0.6}>
          <animate attributeName="opacity" values="0.2;0.9;0.2" dur="2.6s" begin="0.7s" repeatCount="indefinite" />
        </line>
        <line x1={30} y1={55} x2={65} y2={65} stroke="#67e8f9" strokeWidth={0.6}>
          <animate attributeName="opacity" values="0.85;0.15;0.85" dur="1.9s" begin="0.2s" repeatCount="indefinite" />
        </line>
        <line x1={65} y1={65} x2={80} y2={35} stroke="#67e8f9" strokeWidth={0.6}>
          <animate attributeName="opacity" values="0.15;0.75;0.15" dur="3.4s" begin="1.1s" repeatCount="indefinite" />
        </line>
        <line x1={30} y1={55} x2={15} y2={80} stroke="#67e8f9" strokeWidth={0.6}>
          <animate attributeName="opacity" values="0.6;0.1;0.6" dur="2.4s" begin="0.5s" repeatCount="indefinite" />
        </line>
        <line x1={65} y1={65} x2={85} y2={80} stroke="#67e8f9" strokeWidth={0.6}>
          <animate attributeName="opacity" values="0.3;0.85;0.3" dur="2.8s" begin="0.9s" repeatCount="indefinite" />
        </line>
      </svg>
    ),
  },
]

export default function ItemEffectGallery() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Exploratory only — none of these are wired into real Inventory/Equipment/Forge tiles yet. Pick a favorite (or ask for a
        combination of two) and it can be built into the real gear slots next, likely tinted per quality tier.
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
