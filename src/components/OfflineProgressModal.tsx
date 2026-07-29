import CountUp from './CountUpNumber'
import { useOfflineProgressStore } from '../game/combat/useOfflineProgressStore'
import { useZoneStore } from '../game/zones/useZoneStore'
import { ENEMY_TYPES } from '../game/zones/twincrossOutskirts'

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

// Shown once after a load resolves a nonzero offline-progress result (see
// runOfflineProgressCheck, called from GameShell). Renders nothing when there's
// no pending result, so it's safe to mount unconditionally.
export default function OfflineProgressModal() {
  const result = useOfflineProgressStore((state) => state.result)
  const dismiss = useOfflineProgressStore((state) => state.dismiss)
  const selectedMonsterId = useZoneStore((state) => state.selectedMonsterId)

  if (!result || !selectedMonsterId) {
    return null
  }

  const type = ENEMY_TYPES[selectedMonsterId]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">Welcome back</h2>
        <p className="mt-1 text-sm text-slate-400">
          While you were away ({formatDuration(result.elapsedMs)}), your character kept fighting {type.displayName}.
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-slate-300">
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
          {result.itemDrops.length > 0 && (
            <div className="col-span-2 flex justify-between">
              <dt className="text-slate-400">Items found</dt>
              <dd>{result.itemDrops.length}</dd>
            </div>
          )}
        </dl>

        <button
          type="button"
          onClick={dismiss}
          className="mt-6 w-full rounded-lg border border-sky-500 bg-sky-500/10 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/20"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
