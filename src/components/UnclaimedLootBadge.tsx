import { useLootHoldingStore } from '../game/items/useLootHoldingStore'
import { useLootHoldingModalStore } from '../game/items/useLootHoldingModalStore'

// Fixed floating button, bottom-left corner (2026-08-05, confirmed with the
// user — "a little button on the left hand side bottom left corner above the
// Nav bar... this can maybe be the fallback"). The one deliberate way to
// reach leftover Loot Holding entries now that OfflineProgressModal no
// longer auto-reopens itself just because entries exist (see that
// component's own note on why — the auto-reopen was the actual source of
// the reported "duplicate popup" behavior). Renders nothing while Loot
// Holding is empty.
//
// Positioned to clear MobileBottomNav's fixed bar on mobile (`bottom-20`,
// `lg:hidden`'s own nav bar plus its safe-area padding) and sits lower/
// closer to the corner on desktop instead (`lg:bottom-4`), which has no
// fixed bottom nav to clear at all.
export default function UnclaimedLootBadge() {
  const count = useLootHoldingStore((state) => state.entries.length)
  const openModal = useLootHoldingModalStore((state) => state.openModal)

  if (count === 0) {
    return null
  }

  return (
    <button
      type="button"
      onClick={openModal}
      aria-label={`${count} unclaimed item${count === 1 ? '' : 's'} — tap to review`}
      className="fixed bottom-20 left-3 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-amber-500 bg-slate-950/90 text-xl shadow-lg shadow-black/50 backdrop-blur hover:bg-slate-900 lg:bottom-4"
      // translateZ(0), same fix as MobileBottomNav.tsx -- see its comment.
      style={{ transform: 'translateZ(0)' }}
    >
      🎁
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-900 bg-amber-500 px-1 text-[10px] font-bold text-slate-950">
        {count > 99 ? '99+' : count}
      </span>
    </button>
  )
}
