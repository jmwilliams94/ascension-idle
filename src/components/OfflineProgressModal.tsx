import { useState } from 'react'
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
// and no other nonsense") — supersedes both the "shows itself automatically
// whenever any unclaimed entries exist" behavior and the old "closes
// regardless of whether every claim actually succeeded" dismiss:
// - Visibility is now driven by two explicit signals only — a fresh
//   `result`, or useLootHoldingModalStore's own `open` flag (set by
//   UnclaimedLootBadge) — never just "entries happen to exist." That auto-
//   show was the actual source of the reported "a similar or exact same
//   popup happens again": if Claim partially failed (Inventory full — see
//   useLootHoldingStore.claim's own room pre-check) the modal used to close
//   anyway, and the very next GameShell mount would auto-reopen it, showing
//   the same leftover entries as if it were a brand new prompt.
// - Claiming now tracks failures. If everything claims cleanly, the modal
//   dismisses as before. If some entries couldn't fit, it stays open and
//   says so plainly instead of silently closing and resurfacing later —
//   sell them right here (see LootHoldingCard's own per-item Sell) or make
//   room and hit Claim again.
export default function OfflineProgressModal() {
  const result = useOfflineProgressStore((state) => state.result)
  const dismissResult = useOfflineProgressStore((state) => state.dismiss)
  const selectedMonsterId = useZoneStore((state) => state.selectedMonsterId)
  const lootHoldingCount = useLootHoldingStore((state) => state.entries.length)
  const claim = useLootHoldingStore((state) => state.claim)
  const manuallyOpened = useLootHoldingModalStore((state) => state.open)
  const closeManualModal = useLootHoldingModalStore((state) => state.closeModal)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)

  if (!result && !manuallyOpened) {
    return null
  }

  const type = result && selectedMonsterId ? ENEMY_TYPES[selectedMonsterId] : null

  const handleClose = async () => {
    setClaimError(null)

    if (useLootHoldingStore.getState().entries.length > 0) {
      setClaiming(true)
      const ids = useLootHoldingStore.getState().entries.map((entry) => entry.id)
      let failures = 0
      for (const id of ids) {
        const claimResult = await claim(id)
        if (!claimResult.ok) failures += 1
      }
      setClaiming(false)

      if (failures > 0) {
        setClaimError(
          `${failures} item${failures === 1 ? '' : 's'} couldn't fit in your Inventory — sell ${
            failures === 1 ? 'it' : 'them'
          } here, or free up space and hit Claim again.`,
        )
        return
      }
    }

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

        {claimError && <p className="text-xs text-amber-400">{claimError}</p>}

        <button
          type="button"
          disabled={claiming}
          onClick={() => void handleClose()}
          className="w-full rounded-lg border border-sky-500 bg-sky-500/10 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {claiming ? 'Claiming…' : lootHoldingCount > 0 ? 'Claim' : 'Got it'}
        </button>
      </div>
    </div>
  )
}
