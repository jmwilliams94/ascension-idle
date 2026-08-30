import { useState, type CSSProperties, type ReactNode } from 'react'
import { EventEmberBorder } from '../game/hud/eventEmberBorder'
import { EVENT_EMBER_HEX } from '../game/hud/eventEmberBorderData'
import type { EventEmberColor } from '../game/hud/useEventEmberColor'

// 10 candidate replacements for EventEmberBorder's floating-particle ring
// (eventEmberBorder.tsx) -- requested 2026-08-30 so the user can eyeball
// alternatives before committing to any of them. Preview only: nothing here
// is wired into TabNav/MobileBottomNav/CombatPage's real Idling/Events
// buttons yet. Each candidate is pure CSS (see the "Ember-border replacement
// candidates" block at the end of index.css) rather than FxLayer's canvas
// system, since the thing being replaced is itself a small always-on DOM/CSS
// effect, not a one-shot canvas burst.

const COLOR_OPTIONS: { color: EventEmberColor; label: string }[] = [
  { color: 'collecting', label: 'Gold (collecting)' },
  { color: 'boss', label: 'Red (boss)' },
  { color: 'buffActive', label: 'Green (buff active)' },
  { color: 'luckyFree', label: 'Amber (lucky free)' },
]

const TILE_SIZE = 72

function DemoTile({ children, overflowHidden = false }: { children: ReactNode; overflowHidden?: boolean }) {
  return (
    <div
      className={`relative flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-2xl ${overflowHidden ? 'overflow-hidden' : ''}`}
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

export default function EmberCandidateGallery() {
  const [color, setColor] = useState<EventEmberColor>('collecting')
  const hex = EVENT_EMBER_HEX[color]
  const fxStyle: CSSProperties = { '--fx-color': hex } as CSSProperties

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Ember Border Replacement Candidates</h2>
        <p className="text-sm text-slate-400">
          10 alternatives to the current nav-button event embers (the floating-particle ring on the Idling/Events
          buttons), plus the current effect for comparison. Nothing here is wired into the real buttons yet -- purely
          for picking a favorite.
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Candidate id="Current" label="Floating Embers" caption="What's live today, for comparison">
          <DemoTile>
            <EventEmberBorder color={color} seed={2} count={16} />
          </DemoTile>
        </Candidate>

        <Candidate id="1" label="Pulsing Ring" caption="Soft breathing glow ring -- cheapest option">
          <DemoTile>
            <div className="pointer-events-none absolute inset-0 rounded-lg fxcand-pulse-ring" style={fxStyle} />
          </DemoTile>
        </Candidate>

        <Candidate id="2" label="Rotating Border" caption="Spinning gradient ring, like a loading spinner">
          <DemoTile>
            <div className="pointer-events-none absolute -inset-1 fxcand-rotating-border" style={fxStyle} />
          </DemoTile>
        </Candidate>

        <Candidate id="3" label="Corner Flares" caption="Four glowing corners, chasing clockwise">
          <DemoTile>
            {[
              { top: -3, left: -3, delay: 0 },
              { top: -3, right: -3, delay: 0.4 },
              { bottom: -3, right: -3, delay: 0.8 },
              { bottom: -3, left: -3, delay: 1.2 },
            ].map((pos, i) => (
              <span
                key={i}
                className="pointer-events-none absolute h-2 w-2 rounded-full fxcand-corner-flare"
                style={{ ...fxStyle, ...pos, animationDelay: `${pos.delay}s` } as CSSProperties}
              />
            ))}
          </DemoTile>
        </Candidate>

        <Candidate id="4" label="Scan Line Sweep" caption="Bright line sweeping across the button">
          <DemoTile overflowHidden>
            <div className="pointer-events-none absolute inset-y-0 fxcand-scan-sweep" style={fxStyle} />
          </DemoTile>
        </Candidate>

        <Candidate id="5" label="Neon Flicker Outline" caption="Unstable neon-sign flicker on the border">
          <DemoTile>
            <div className="pointer-events-none absolute inset-0 rounded-lg fxcand-neon-flicker" style={fxStyle} />
          </DemoTile>
        </Candidate>

        <Candidate id="6" label="Shimmer Sheen" caption="Diagonal light sweep, like polished metal">
          <DemoTile overflowHidden>
            <div className="pointer-events-none absolute inset-y-0 fxcand-shimmer" style={fxStyle} />
          </DemoTile>
        </Candidate>

        <Candidate id="7" label="Marching Ants" caption="Dashed outline crawling like a selection marquee">
          <DemoTile>
            <svg
              className="pointer-events-none absolute inset-0 fxcand-marching-ants"
              width={TILE_SIZE}
              height={TILE_SIZE}
              style={fxStyle}
            >
              <rect x={2} y={2} width={TILE_SIZE - 4} height={TILE_SIZE - 4} rx={10} />
            </svg>
          </DemoTile>
        </Candidate>

        <Candidate id="8" label="Radar Sweep" caption="Rotating wedge of light, like a radar scan">
          <DemoTile>
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
              <div className="absolute -inset-1/2 fxcand-radar-sweep" style={fxStyle} />
            </div>
          </DemoTile>
        </Candidate>

        <Candidate id="9" label="Chromatic Pulse Glow" caption="Large soft aura pulsing scale + opacity">
          <DemoTile>
            <div
              className="pointer-events-none absolute -inset-3 rounded-full fxcand-chromatic-pulse"
              style={{ ...fxStyle, filter: 'blur(3px)' } as CSSProperties}
            />
          </DemoTile>
        </Candidate>

        <Candidate id="10" label="Comet Orbit Dot" caption="One bright particle orbiting the border with a trail">
          <DemoTile>
            <span
              className="pointer-events-none absolute h-2 w-2 rounded-full fxcand-comet-orbit"
              style={{ ...fxStyle, top: '50%', left: '50%', marginTop: -4, marginLeft: -4, '--fx-orbit-radius': `${TILE_SIZE / 2 + 6}px` } as CSSProperties}
            />
          </DemoTile>
        </Candidate>
      </div>
    </div>
  )
}
