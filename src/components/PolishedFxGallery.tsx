import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { EVENT_EMBER_HEX } from '../game/hud/eventEmberBorderData'
import type { EventEmberColor } from '../game/hud/useEventEmberColor'

// Two non-WebGL alternatives to EventEmberBorder's CSS particle ring
// (2026-08-30) -- after the WebGL shader gallery (WebglEmberGallery.tsx,
// deleted) turned out to render frame-identical screenshots despite the
// render loop/uniforms provably ticking at 60fps (instrumented directly,
// never root-caused -- likely a headless/software-GL or mobile-Safari-class
// WebGL context/compositor quirk, not dead code), the user asked for
// alternatives that don't carry WebGL's context/driver risk at all.
// SVG filters (feTurbulence/feGaussianBlur/feDisplacementMap) animate via
// native browser SMIL <animate> -- no JS render loop, no WebGL context,
// nothing that can silently stop ticking. Framer Motion (already used
// app-wide, see MobileBottomNav.tsx etc.) drives plain CSS transforms via
// the Web Animations API -- same DOM/CSS territory as the very first plain-
// CSS gallery, just with better-tuned spring/orchestration timing. Both
// shown side by side per the user's request to compare them directly.
// Preview only -- not wired into any real nav button yet.

const TILE_SIZE = 96

const COLOR_OPTIONS: { color: EventEmberColor; label: string }[] = [
  { color: 'collecting', label: 'Gold (collecting)' },
  { color: 'boss', label: 'Red (boss)' },
  { color: 'buffActive', label: 'Green (buff active)' },
  { color: 'luckyFree', label: 'Amber (lucky free)' },
]

function Tile({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-2xl"
      style={{ width: TILE_SIZE, height: TILE_SIZE }}
    >
      ⛏️
      {children}
    </div>
  )
}

function Candidate({ id, label, caption, children }: { id: string; label: string; caption: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-center">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{id}</span>
      {children}
      <div>
        <p className="text-sm font-medium text-slate-200">{label}</p>
        <p className="mt-0.5 text-xs text-slate-500">{caption}</p>
      </div>
    </div>
  )
}

// -- SVG filter candidates ---------------------------------------------

const RING_ATTRS = { x: 6, y: 6, width: TILE_SIZE - 12, height: TILE_SIZE - 12, rx: 16, fill: 'none' } as const

function TurbulencePlasmaBorder({ color }: { color: string }) {
  const id = useId()
  return (
    <svg className="pointer-events-none absolute inset-0" width={TILE_SIZE} height={TILE_SIZE}>
      <defs>
        <filter id={id} x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.3" numOctaves={2} seed={3} result="noise">
            <animate attributeName="baseFrequency" values="0.05 0.3;0.09 0.35;0.05 0.3" dur="6s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={8} xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation={0.6} />
        </filter>
      </defs>
      <rect {...RING_ATTRS} stroke={color} strokeWidth={4} filter={`url(#${id})`} />
    </svg>
  )
}

function AuroraGlowWave({ color }: { color: string }) {
  const id = useId()
  return (
    <svg className="pointer-events-none absolute inset-0" width={TILE_SIZE} height={TILE_SIZE}>
      <defs>
        <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={3} result="blur" />
          <feColorMatrix in="blur" type="hueRotate" values="0">
            <animate attributeName="values" values="0;35;0;-35;0" dur="5s" repeatCount="indefinite" />
          </feColorMatrix>
        </filter>
      </defs>
      <rect {...RING_ATTRS} stroke={color} strokeWidth={9} filter={`url(#${id})`} />
    </svg>
  )
}

function FrostedGlassRim({ color }: { color: string }) {
  const id = useId()
  return (
    <svg className="pointer-events-none absolute inset-0" width={TILE_SIZE} height={TILE_SIZE}>
      <defs>
        <filter id={id} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={1.2} />
        </filter>
      </defs>
      <rect {...RING_ATTRS} stroke={color} strokeWidth={3} filter={`url(#${id})`}>
        <animate attributeName="stroke-opacity" values="0.5;1;0.5" dur="2.4s" repeatCount="indefinite" />
      </rect>
    </svg>
  )
}

function DisplacementRippleRing({ color }: { color: string }) {
  const id = useId()
  return (
    <svg className="pointer-events-none absolute inset-0" width={TILE_SIZE} height={TILE_SIZE}>
      <defs>
        <filter id={id} x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="turbulence" baseFrequency="0.02 0.2" numOctaves={2} seed={7} result="noise">
            <animate attributeName="baseFrequency" values="0.02 0.2;0.05 0.24;0.02 0.2" dur="3.2s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={14} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <rect {...RING_ATTRS} stroke={color} strokeWidth={3} filter={`url(#${id})`} />
    </svg>
  )
}

function SoftBloomPulse({ color }: { color: string }) {
  const id = useId()
  return (
    <svg className="pointer-events-none absolute inset-0" width={TILE_SIZE} height={TILE_SIZE}>
      <defs>
        <filter id={id} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={2}>
            <animate attributeName="stdDeviation" values="1;4;1" dur="2.2s" repeatCount="indefinite" />
          </feGaussianBlur>
        </filter>
      </defs>
      <rect {...RING_ATTRS} stroke={color} strokeWidth={6} filter={`url(#${id})`} />
    </svg>
  )
}

// -- Framer Motion candidates --------------------------------------------

function MotionPulsingRing({ color }: { color: string }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 rounded-lg"
      animate={{ opacity: [0.6, 1, 0.6], scale: [0.97, 1.03, 0.97] }}
      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      style={{ boxShadow: `0 0 0 1.5px ${color}, 0 0 16px 4px ${color}99` }}
    />
  )
}

function MotionRotatingBorder({ color }: { color: string }) {
  const style: CSSProperties = {
    background: `conic-gradient(from 0deg, transparent 0%, ${color} 15%, transparent 35%, transparent 65%, ${color} 85%, transparent 100%)`,
    WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))',
    mask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))',
  }
  return (
    <motion.div
      className="pointer-events-none absolute -inset-1"
      animate={{ rotate: 360 }}
      transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
      style={style}
    />
  )
}

function MotionShimmerSweep({ color }: { color: string }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-y-0"
      animate={{ x: ['-120%', '220%'] }}
      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      style={{ width: '35%', background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
    />
  )
}

function MotionCornerFlares({ color }: { color: string }) {
  const positions = [
    { top: -3, left: -3 },
    { top: -3, right: -3 },
    { bottom: -3, right: -3 },
    { bottom: -3, left: -3 },
  ]
  return (
    <>
      {positions.map((pos, i) => (
        <motion.span
          key={i}
          className="pointer-events-none absolute h-2 w-2 rounded-full"
          animate={{ opacity: [0.25, 1, 0.25], scale: [0.85, 1.15, 0.85] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.4, ease: 'easeInOut' }}
          style={{ ...pos, background: color, boxShadow: `0 0 8px 2px ${color}` } as CSSProperties}
        />
      ))}
    </>
  )
}

function MotionCometOrbit({ color }: { color: string }) {
  return (
    <motion.div
      className="pointer-events-none absolute inset-0"
      animate={{ rotate: 360 }}
      transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
    >
      <span
        className="absolute h-2 w-2 rounded-full"
        style={{
          top: '50%',
          left: '50%',
          marginTop: -4,
          marginLeft: -4,
          transform: `translateY(-${TILE_SIZE / 2 - 6}px)`,
          background: color,
          boxShadow: `0 0 6px 2px ${color}`,
        }}
      />
    </motion.div>
  )
}

export default function PolishedFxGallery() {
  const [color, setColor] = useState<EventEmberColor>('collecting')
  const hex = EVENT_EMBER_HEX[color]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">SVG Filters vs. Framer Motion</h2>
        <p className="text-sm text-slate-400">
          Two non-WebGL alternatives to EventEmberBorder's particle ring, shown side by side. SVG filters
          (feTurbulence/feGaussianBlur/feDisplacementMap) animate natively via the browser -- no JS render loop, no
          WebGL context risk. Framer Motion drives the same plain-CSS territory as the original gallery, just with
          better-tuned spring/orchestration timing.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {COLOR_OPTIONS.map((opt) => (
          <button
            key={opt.color}
            type="button"
            onClick={() => setColor(opt.color)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              color === opt.color
                ? 'border-white/60 bg-white/10 text-white'
                : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:border-slate-500'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">SVG Filters</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Candidate id="1" label="Turbulence Plasma Border" caption="Animated noise-displaced border, organic energy wobble">
            <Tile>
              <TurbulencePlasmaBorder color={hex} />
            </Tile>
          </Candidate>
          <Candidate id="2" label="Aurora Glow Wave" caption="Real Gaussian blur + animated hue-rotate">
            <Tile>
              <AuroraGlowWave color={hex} />
            </Tile>
          </Candidate>
          <Candidate id="3" label="Frosted Glass Rim" caption="True blur-based rim, breathing opacity">
            <Tile>
              <FrostedGlassRim color={hex} />
            </Tile>
          </Candidate>
          <Candidate id="4" label="Displacement Ripple Ring" caption="Liquid-feeling turbulence ripple on the border">
            <Tile>
              <DisplacementRippleRing color={hex} />
            </Tile>
          </Candidate>
          <Candidate id="5" label="Soft Bloom Pulse" caption="Real optical blur radius pulsing, not a fake box-shadow">
            <Tile>
              <SoftBloomPulse color={hex} />
            </Tile>
          </Candidate>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Framer Motion</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Candidate id="6" label="Pulsing Ring" caption="Spring-eased breathing glow ring">
            <Tile>
              <MotionPulsingRing color={hex} />
            </Tile>
          </Candidate>
          <Candidate id="7" label="Rotating Border" caption="Smoothly spinning gradient ring">
            <Tile>
              <MotionRotatingBorder color={hex} />
            </Tile>
          </Candidate>
          <Candidate id="8" label="Shimmer Sweep" caption="Eased diagonal light sweep">
            <Tile>
              <MotionShimmerSweep color={hex} />
            </Tile>
          </Candidate>
          <Candidate id="9" label="Corner Flares" caption="Staggered spring pulse, clockwise chase">
            <Tile>
              <MotionCornerFlares color={hex} />
            </Tile>
          </Candidate>
          <Candidate id="10" label="Comet Orbit Dot" caption="Smoothly orbiting particle with glow">
            <Tile>
              <MotionCometOrbit color={hex} />
            </Tile>
          </Candidate>
        </div>
      </div>
    </div>
  )
}
