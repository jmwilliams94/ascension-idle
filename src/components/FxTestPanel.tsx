import { useRef } from 'react'
import { useFxStore, type FxKind } from '../game/fx/useFxStore'

const EXAMPLES: { kind: FxKind; label: string; caption: string }[] = [
  { kind: 'lightning', label: '⚡ Lightning Strike', caption: 'Procedural branching bolt (Wuxia attack flavor) -- midpoint displacement, not a canned shape' },
  { kind: 'comet', label: '☄️ Comet Impact', caption: 'Falls in from a screen edge, shockwave rings + a brief screen shake on landing' },
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
  const iconRef = useRef<HTMLButtonElement>(null)

  // Fires the ripple from the icon tile's own center rather than screen
  // center -- previews the real intended use (a composition/quality upgrade
  // success rippling out from that item's own icon, see
  // project_fx_layer_canvas_effects memory's "confirmed design direction")
  // instead of the generic demo the earlier plain trigger button gave.
  const fireFromIcon = () => {
    const rect = iconRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }
    trigger('ripple', { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">FX</h2>
        <p className="text-sm text-slate-400">
          Full-screen canvas effects (FxLayer.tsx) — each one fires above everything on the page, including this
          modal. A screenshot won't show the motion.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

      <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
        <p className="text-sm font-medium text-slate-200">💫 Upgrade Ripple</p>
        <p className="mt-1 text-xs text-slate-500">
          Click the item icon below -- the ripple fires from its border and radiates outward, previewing how it'll
          look on a real composition/quality upgrade success (not from screen center).
        </p>
        <div className="mt-3 flex justify-center">
          <button
            ref={iconRef}
            type="button"
            onClick={fireFromIcon}
            className="flex h-14 w-14 items-center justify-center rounded-lg border-2 text-2xl transition hover:brightness-125 lg:h-16 lg:w-16"
            // #A855F7 -- the established Radiant gear-quality color (see
            // QUALITY_COLORS in equipmentBonus.ts), matching InventorySlot's
            // own qualityColor styling convention rather than inventing a
            // one-off color for this test tile.
            style={{ borderColor: '#A855F7', backgroundColor: '#A855F722' }}
            aria-label="Test item icon -- click to fire the ripple from here"
          >
            🗡️
          </button>
        </div>
      </div>
    </div>
  )
}
