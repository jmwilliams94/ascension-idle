import { lazy, Suspense, useState } from 'react'
import SideScrollerGreybox from './SideScrollerGreybox'

// Lazy -- pulls in three/@react-three/fiber/drei, same 2MB Workbox precache
// concern as RenderingTestPanel/FxTestPanel (see SettingsModal.tsx's comment
// on those two). SideScrollerGreybox is plain Canvas2D so it's fine eager.
const ArcheroGreybox = lazy(() => import('./ArcheroGreybox'))

type GreyboxScene = 'side-scroller' | 'archero-3d' | null

// Greybox (2026-09-12, requested by the user) -- admin-only launcher for two
// early full-screen prototypes exploring a potential future replacement for
// Hunting's current idle/AFK combat: a manual, jump-around-and-kill loop.
// Both scenes are throwaway proof-of-concept only (no real drop tables, no
// server writes, no shared state with the live game) -- they exist purely to
// test movement/camera/combat *feel* before any real design or wiring
// decision is made. See CLAUDE.md's "Explicitly cut" section: the previous
// isometric/manual-combat system was torn out deliberately, so reintroducing
// any spatial combat needs to be a fresh, deliberate call -- this panel is
// that discussion, not an accidental revert.
export default function GreyboxPanel() {
  const [scene, setScene] = useState<GreyboxScene>(null)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Greybox</h2>
        <p className="text-sm text-slate-400">
          Full-screen movement/combat prototypes -- no real rewards, nothing wired to the live game. Admin-only.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setScene('side-scroller')}
          className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-left hover:border-amber-500/60"
        >
          <p className="font-semibold text-slate-100">Side-Scroller</p>
          <p className="mt-1 text-xs text-slate-400">
            2.5D-feel platformer: parallax depth layers, jump/move, click a nearby enemy to kill it for gold + loot beans.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setScene('archero-3d')}
          className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-left hover:border-amber-500/60"
        >
          <p className="font-semibold text-slate-100">Archero-style 3D</p>
          <p className="mt-1 text-xs text-slate-400">
            Simple 3D primitives, top-down angled follow camera, free WASD movement, auto-fires at the nearest enemy.
          </p>
        </button>
      </div>

      {scene === 'side-scroller' && <SideScrollerGreybox onExit={() => setScene(null)} />}
      {scene === 'archero-3d' && (
        <Suspense fallback={null}>
          <ArcheroGreybox onExit={() => setScene(null)} />
        </Suspense>
      )}
    </div>
  )
}
