import { useOverlayStore, type OverlayId } from '../game/hud/useOverlayStore'

// Zone/Equipment/Forge/Marketplace/Shop each open as an overlay on top of the game
// canvas (see GameShell/OverlayPanel) — this bottom nav is their only entry point;
// none of them have a presence in the side HUD anymore (see SideHud).
const BOTTOM_NAV_ITEMS: { id: OverlayId; label: string }[] = [
  { id: 'zone', label: 'Zone' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'forge', label: 'Forge' },
  { id: 'marketplace', label: 'Market' },
  { id: 'shop', label: 'Shop' },
]

export default function BottomNav() {
  const activeOverlay = useOverlayStore((state) => state.activeOverlay)
  const toggle = useOverlayStore((state) => state.toggle)

  return (
    <div className="mt-4 grid grid-cols-5 gap-2">
      {BOTTOM_NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => toggle(item.id)}
          className={`rounded-xl border px-3 py-3 text-sm font-medium ${
            item.id === activeOverlay
              ? 'border-sky-500 bg-sky-500/10 text-sky-300'
              : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
