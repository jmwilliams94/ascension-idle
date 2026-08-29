import { useFxStore, type FxKind } from '../game/fx/useFxStore'

const EXAMPLES: { kind: FxKind; label: string; caption: string }[] = [
  { kind: 'lightning', label: '⚡ Lightning Strike', caption: 'Procedural branching bolt (Wuxia attack flavor) -- midpoint displacement, not a canned shape' },
  { kind: 'comet', label: '☄️ Comet Impact', caption: 'Falls in from a screen edge, shockwave rings + a brief screen shake on landing' },
  { kind: 'ripple', label: '💫 Upgrade Ripple', caption: 'Staggered gold rings pulsing outward from screen center' },
]

// FX Test (2026-08-29, requested by the user) -- dev/debug tab for
// previewing FxLayer.tsx's full-screen canvas effect system, the polished/
// organic counterpart to tierEffects.tsx's DOM/CSS ember system (see
// ItemEffectGallery.tsx, this tab's closest precedent). Each button just
// calls useFxStore.trigger() -- FxLayer (mounted once in GameShell) picks
// the request up on its own requestAnimationFrame loop and renders it as an
// overlay above everything, including this modal, so you can see it isn't
// clipped by or confined to any container. Not gameplay UI -- these effects
// aren't wired to any real trigger (a Wuxia attack, an Ascend, a Comet
// drop) yet, this is purely for eyeballing what the system can do.
export default function FxTestPanel() {
  const trigger = useFxStore((state) => state.trigger)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">FX</h2>
        <p className="text-sm text-slate-400">
          Full-screen canvas effects (FxLayer.tsx) — each one fires above everything on the page, including this
          modal. A screenshot won't show the motion.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {EXAMPLES.map((example) => (
          <button
            key={example.kind}
            type="button"
            onClick={() => trigger(example.kind)}
            className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-3 text-left text-sm text-slate-200 transition hover:border-amber-500/60 hover:bg-slate-900"
          >
            <span className="block font-medium">{example.label}</span>
            <span className="mt-1 block text-xs text-slate-500">{example.caption}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
