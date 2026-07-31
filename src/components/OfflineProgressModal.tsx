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
// never be reachable again. "Got it" dismisses the whole thing for the rest
// of this page load regardless of what's still unclaimed (a deliberately
// simple, non-blocking choice — anything left will resurface the same way
// next time the app loads, rather than this modal staying permanently
// un-dismissable until every last entry is dealt with).
export default function OfflineProgressModal() {
  const result = useOfflineProgressStore((state) => state.result)
  const dismissResult = useOfflineProgressStore((state) => state.dismiss)
  const selectedMonsterId = useZoneStore((state) => state.selectedMonsterId)
  const lootHoldingCount = useLootHoldingStore((state) => state.entries.length)
  const [closed, setClosed] = useState(false)

  if (closed || (!result && lootHoldingCount === 0)) {
    return null
  }

  const type = result && selectedMonsterId ? ENEMY_TYPES[selectedMonsterId] : null

  const handleClose = () => {
    dismissResult()
    setClosed(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <div>
          <h2 className="text-lg font-semibold text-white">{result ? 'Welcome back' : 'Unclaimed rewards'}</h2>
          {result && type && (
            <p className="mt-1 text-sm text-slate-400">
              While you were away ({formatDuration(result.elapsedMs)}), your character kept fighting {type.displayName}.
            </p>
          )}
        </div>

        {result && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-slate-300">
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
            {result.meteors > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-400">Meteors</dt>
                <dd className="font-semibold text-slate-200">+{result.meteors}</dd>
              </div>
            )}
            {result.dragonballs > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-400">DragonBalls</dt>
                <dd className="font-semibold text-slate-200">+{result.dragonballs}</dd>
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
