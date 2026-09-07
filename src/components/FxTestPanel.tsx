import { useFxStore, type FxKind } from '../game/fx/useFxStore'
import { TAB_ICONS } from '../game/hud/navIcons'
import NavIconGlyph from './NavIconGlyph'

const LIGHTNING: { kind: FxKind; label: string; caption: string } = {
  kind: 'lightning',
  label: '⚡ Lightning Strike',
  caption: 'Procedural branching bolt (Wuxia attack flavor) -- midpoint displacement, not a canned shape',
}

// Flash-streak family (2026-08-31, requested by the user -- reference:
// Warcraft 3 Reign of Chaos' golem-drop flash, and a shooting star) for a
// comet material landing in the inventory after a kill. Plain 2D canvas,
// no WebGL warp -- see meteorFlash.ts for what each one is going for. The
// original 8-variant set was replaced with these after the user picked
// Flash Streak as the only one that read as polished, not cheap.
const FLASH_EXAMPLES: { kind: FxKind; label: string; caption: string }[] = [
  { kind: 'flash-streak', label: '☄️ Flash Streak', caption: 'Short bright streak sweeps in from off-screen and ends in a burst (the original)' },
  {
    kind: 'flash-streak-purple',
    label: '💜 Flash Streak — Purple',
    caption: 'Layered violet glow/core, glinting sparkle trail, thin expanding ring finish -- live on every real Comet drop (see resolveCombat.ts/resolveRowCombat.ts)',
  },
  { kind: 'flash-streak-shooting-star', label: '🌠 Shooting Star', caption: 'Dark blue-to-pink arc with twinkling sparkles, fades out instead of exploding -- unused' },
  { kind: 'flash-streak-crater', label: '🕳️ Comet Crater', caption: 'Streaks in and embeds -- impact flare, fracture cracks, drifting dust, a dark crater -- unused' },
]

// FX Test (2026-08-29, requested by the user) -- dev/debug tab for
// previewing FxLayer.tsx's full-screen canvas effect system, the polished/
// organic counterpart to tierEffects.tsx's DOM/CSS ember system (see
// ItemEffectGallery.tsx, this tab's closest precedent). Each button just
// calls useFxStore.trigger() -- FxLayer (mounted once in GameShell) picks
// the request up on its own requestAnimationFrame loop and renders it as an
// overlay above everything, including this modal, so you can see it isn't
// clipped by or confined to any container. Not gameplay UI itself -- this is
// for eyeballing/comparing the effects, even though flash-streak-purple is
// now also fired for real elsewhere (see its own caption below). Lightning
// still isn't wired to a real trigger (a Wuxia attack, an Ascend, ...).
//
// Pared back to just Lightning + the flash-streak family (2026-08-31,
// requested by the user -- everything else previously here, comet/ripple/
// the SVG-filter+Framer-Motion ember gallery, and the original 8-variant
// flash set, is gone; comet.ts/ripple.ts still exist for their confirmed
// future gameplay use, just not previewed here anymore).
export default function FxTestPanel() {
  const trigger = useFxStore((state) => state.trigger)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">FX</h2>
        <p className="text-sm text-slate-400">
          Full-screen canvas effects (FxLayer.tsx) — each one fires behind this modal (FX sits below the app's modal
          layer on purpose). Close this panel to see it clearly. A screenshot won't show the motion.
        </p>
      </div>

      <button
        type="button"
        onClick={() => trigger(LIGHTNING.kind)}
        className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-3 text-left text-sm text-slate-200 transition hover:border-amber-500/60 hover:bg-slate-900"
      >
        <span className="block font-medium">{LIGHTNING.label}</span>
        <span className="mt-1 block text-xs text-slate-300">{LIGHTNING.caption}</span>
      </button>

      <div className="border-t border-slate-800 pt-4">
        <h3 className="text-sm font-semibold text-white">Meteor Flash</h3>
        <p className="mt-1 text-xs text-slate-300">
          Purple was picked for a real Comet drop landing in the inventory after a kill; the rest stay here unused.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FLASH_EXAMPLES.map((example) => (
            <button
              key={example.kind}
              type="button"
              onClick={() => trigger(example.kind)}
              className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-3 text-left text-sm text-slate-200 transition hover:border-amber-500/60 hover:bg-slate-900"
            >
              <span className="block font-medium">{example.label}</span>
              <span className="mt-1 block text-xs text-slate-300">{example.caption}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-800 pt-4">
        <h3 className="text-sm font-semibold text-white">Button Concept — Uiverse Glass Card</h3>
        <p className="mt-1 text-xs text-slate-300">
          A pasted Uiverse.io button concept (by Itskrish01), re-themed as an Equipment button example — Discord icon
          swapped for the real Equipment nav icon, name centered in our heading font. Not wired to anything, just a
          preview.
        </p>
        <div className="mt-2 max-w-sm">
          <button
            type="button"
            className="group relative w-full cursor-pointer overflow-hidden rounded-2xl border-2 border-indigo-500/30 bg-gradient-to-br from-indigo-900/40 via-neutral-900/60 to-black/80 p-4 shadow-2xl backdrop-blur-xl transition-all duration-500 ease-out hover:scale-[1.02] hover:-translate-y-1 hover:border-indigo-400/60 hover:shadow-2xl hover:shadow-indigo-500/30 active:scale-95"
          >
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-indigo-400/30 to-transparent transition-transform duration-1000 ease-out group-hover:translate-x-full" />
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-indigo-500/10 via-indigo-400/20 to-indigo-500/10 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

            <div className="relative z-10 flex items-center gap-4">
              <div className="rounded-lg bg-gradient-to-br from-indigo-500/30 to-indigo-600/10 p-3 backdrop-blur-sm transition-all duration-300 group-hover:from-indigo-400/40 group-hover:to-indigo-500/20">
                <NavIconGlyph icon={TAB_ICONS.equipment} sizeClassName="h-7 w-7" />
              </div>
              <p className="flex-1 text-center font-heading text-lg font-bold uppercase tracking-[0.08em] text-indigo-300 drop-shadow-sm transition-colors duration-300 group-hover:text-indigo-200">
                Equipment
              </p>
              <div className="opacity-40 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" className="h-5 w-5 text-indigo-400">
                  <path d="M9 5l7 7-7 7" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"></path>
                </svg>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
