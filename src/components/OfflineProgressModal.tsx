import CountUp from './CountUpNumber'
import LootHoldingCard from './LootHoldingCard'
import { useOfflineProgressStore } from '../game/combat/useOfflineProgressStore'
import { useLootHoldingStore } from '../game/items/useLootHoldingStore'
import { useLootHoldingModalStore } from '../game/items/useLootHoldingModalStore'
import { useZoneStore } from '../game/zones/useZoneStore'
import { ENEMY_TYPES } from '../game/zones/zoneData'

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

// Shown after a load resolves a nonzero offline-progress result (see
// runOfflineProgressCheck, called from GameShell) — the "Welcome back"
// mode — or when UnclaimedLootBadge's fallback button is tapped (the
// "Unclaimed rewards" mode). Renders nothing otherwise, so it's safe to
// mount unconditionally.
// Loot Holding moved here entirely (2026-07-31, per the user's request) —
// it's no longer a persistent Warehouse card, it's exclusively an "idle
// rewards" interface now (see LootHoldingCard's own note, and CLAUDE.md's
// Loot section). Live play never populates it at all anymore (a full
// Inventory during active combat stops the fight instead — see
// useCombatStore.stopForInventoryFull/InventoryFullWarningHud); the offline/
// idle-progress simulator is its only remaining source.
//
// Reworked (2026-08-05, confirmed with the user: "I need it to prompt first
// with hey welcome back... anything after that is likely not necessary" /
// "make sure the first thing that pops up is the correct idle rewards popup
// and no other nonsense") — supersedes the earlier "shows itself
// automatically whenever any unclaimed entries exist" behavior:
// - Visibility is driven by two explicit signals only — a fresh `result`,
//   or useLootHoldingModalStore's own `open` flag (set by
//   UnclaimedLootBadge) — never just "entries happen to exist." That auto-
//   show was the actual source of a previously-reported "a similar or exact
//   same popup happens again" bug.
//
// Bottom button simplified back to a plain, always-available dismiss
// (2026-08-07) — supersedes the 2026-08-05 "stays open and loops Claim on
// every remaining entry, forcing the player to resolve everything before
// closing" behavior. That forcing was a workaround for Claim being the only
// way off this screen; now that LootHoldingCard's own staged Claim/Store/
// Sell flow (see that file) guarantees a real, always-available way to
// resolve anything left (Store bypasses Inventory's cap entirely), the
// modal no longer needs to hold the player hostage to a bulk claim
// succeeding — "Got it" just closes, and UnclaimedLootBadge's 🎁 button
// remains the way back to anything still unresolved.
export default function OfflineProgressModal() {
  const result = useOfflineProgressStore((state) => state.result)
  const dismissResult = useOfflineProgressStore((state) => state.dismiss)
  const selectedMonsterId = useZoneStore((state) => state.selectedMonsterId)
  const lootHoldingCount = useLootHoldingStore((state) => state.entries.length)
  const manuallyOpened = useLootHoldingModalStore((state) => state.open)
  const closeManualModal = useLootHoldingModalStore((state) => state.closeModal)

  if (!result && !manuallyOpened) {
    return null
  }

  const type = result && selectedMonsterId ? ENEMY_TYPES[selectedMonsterId] : null

  const handleClose = () => {
    dismissResult()
    closeManualModal()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      {/* max-h + overflow-y-auto — the backdrop is a fixed, non-scrolling
          viewport-filling flex container, so without a height cap and its own
          scroll the card just overflows past the screen edge on a phone with
          no way to reach whatever's below the fold (Loot Holding's grid,
          bulk-action bar, detail card, even the "Got it" button itself). */}
      <div className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-5 shadow-2xl shadow-black/60">
        <div className="flex items-start gap-3">
          <span className="text-2xl">{result ? '👋' : '📦'}</span>
          <div>
            <h2 className="text-lg font-semibold text-white">{result ? 'Welcome back' : 'Unclaimed rewards'}</h2>
            {result && type && (
              <p className="mt-1 text-sm text-slate-400">
                While you were away ({formatDuration(result.elapsedMs)}), your character kept fighting {type.displayName}.
              </p>
            )}
          </div>
        </div>

        {result && result.petObtained && (
          <div className="relative rounded-xl border border-amber-400 bg-amber-500/10 p-3 text-center shadow-lg shadow-amber-500/20">
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-slate-950">
              NEW PET
            </span>
            <p className="mt-1 text-sm font-semibold text-amber-300">
              🎉 You obtained the {result.petObtained} pet while you were away!
            </p>
          </div>
        )}

        {result && result.fallenStars > 0 && (
          <div className="relative rounded-xl border border-violet-400 bg-violet-500/10 p-3 text-center shadow-lg shadow-violet-500/20">
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-violet-500 px-1.5 py-0.5 text-[9px] font-bold text-slate-950">
              RARE DROP
            </span>
            <p className="mt-1 text-sm font-semibold text-violet-300">
              ✨ A Fallen Star dropped while you were away! (+{result.fallenStars})
            </p>
          </div>
        )}

        {result && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
            <div className="flex justify-between">
              <dt className="text-slate-400">Kills</dt>
              <dd>{result.kills}</dd>
            </div>
            {result.rareKills > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-400">Rare kills</dt>
                <dd className="text-amber-300">{result.rareKills}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-400">Gold</dt>
              <dd>
                <CountUp end={result.gold} duration={1.2} className="font-semibold text-amber-300" />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">EXP</dt>
              <dd>
                <CountUp end={result.exp} duration={1.2} className="font-semibold text-sky-300" />
              </dd>
            </div>
            {result.itemsFoundCount > 0 && (
              <div className="col-span-2 flex justify-between">
                <dt className="text-slate-400">Items found</dt>
                <dd>{result.itemsFoundCount}</dd>
              </div>
            )}
            {result.comets > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-400">Comets</dt>
                <dd className="font-semibold text-slate-200">+{result.comets}</dd>
              </div>
            )}
          </dl>
        )}

        {lootHoldingCount > 0 && <LootHoldingCard />}

        <button
          type="button"
          onClick={handleClose}
          className="w-full rounded-lg border border-sky-500 bg-sky-500/10 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/20"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
