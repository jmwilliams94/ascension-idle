import { useState } from 'react'
import CountUp from './CountUpNumber'
import LootHoldingCard from './LootHoldingCard'
import { useOfflineProgressStore } from '../game/combat/useOfflineProgressStore'
import { useLootHoldingStore } from '../game/items/useLootHoldingStore'
import { useZoneStore } from '../game/zones/useZoneStore'
import { ENEMY_TYPES } from '../game/zones/zoneData'

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

// Shown once after a load resolves a nonzero offline-progress result (see
// runOfflineProgressCheck, called from GameShell). Renders nothing when
// there's no pending result AND no outstanding Loot Holding entries, so it's
// safe to mount unconditionally.
// Loot Holding moved here entirely (2026-07-31, per the user's request) —
// it's no longer a persistent Warehouse card, it's exclusively an "idle
// rewards" interface now (see LootHoldingCard's own note, and CLAUDE.md's
// Loot section). Live play never populates it at all anymore (a full
// Inventory during active combat stops the fight instead — see
// useCombatStore.stopForInventoryFull/InventoryFullWarningHud); the offline/
// idle-progress simulator is its only remaining source. Since there's no
// other UI surface for it now, this modal shows itself even when there's no
// fresh offline gain worth a "Welcome back" summary, as long as unclaimed
// entries exist (e.g. left over from a previous session) — otherwise they'd
// never be reachable again.
//
// Bottom button simplified (2026-08-03, per the user's request): the old
// per-item detail card, checkbox multi-select, and "Claim All" button inside
// LootHoldingCard are gone (see that file's own note) — this modal's own
// bottom button now does the claiming. It reads "Claim" (and claims every
// remaining entry, one at a time so each honors the live Inventory-room
// check rather than racing it) whenever Loot Holding has anything left,
// falling back to the plain "Got it" label/behavior when it's already empty.
// Still a deliberately simple, non-blocking dismiss either way — closes
// regardless of whether every claim actually succeeded (e.g. Inventory
// filled up partway through); anything left unclaimed resurfaces the same
// way next time the app loads, rather than this modal staying permanently
// un-dismissable until every last entry is dealt with.
export default function OfflineProgressModal() {
  const result = useOfflineProgressStore((state) => state.result)
  const dismissResult = useOfflineProgressStore((state) => state.dismiss)
  const selectedMonsterId = useZoneStore((state) => state.selectedMonsterId)
  const lootHoldingCount = useLootHoldingStore((state) => state.entries.length)
  const claim = useLootHoldingStore((state) => state.claim)
  const [closed, setClosed] = useState(false)
  const [claiming, setClaiming] = useState(false)

  if (closed || (!result && lootHoldingCount === 0)) {
    return null
  }

  const type = result && selectedMonsterId ? ENEMY_TYPES[selectedMonsterId] : null

  const handleClose = async () => {
    if (useLootHoldingStore.getState().entries.length > 0) {
      setClaiming(true)
      const ids = useLootHoldingStore.getState().entries.map((entry) => entry.id)
      for (const id of ids) {
        await claim(id)
      }
      setClaiming(false)
    }
    dismissResult()
    setClosed(true)
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
