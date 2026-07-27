import { useEffect } from 'react'
import { requiredExpForLevel, useProgressionStore } from '../game/stats/useProgressionStore'

export default function ProgressionPanel() {
  const level = useProgressionStore((state) => state.level)
  const exp = useProgressionStore((state) => state.exp)
  const gold = useProgressionStore((state) => state.gold)
  const lastLevelUp = useProgressionStore((state) => state.lastLevelUp)
  const clearLevelUpNotice = useProgressionStore((state) => state.clearLevelUpNotice)

  useEffect(() => {
    if (lastLevelUp === null) {
      return
    }

    const timeout = setTimeout(() => clearLevelUpNotice(), 2200)
    return () => clearTimeout(timeout)
  }, [lastLevelUp, clearLevelUpNotice])

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-sm font-medium text-slate-200">Progression</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-300">
        <div className="flex justify-between">
          <dt className="text-slate-400">Level</dt>
          <dd>{level}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-400">Gold</dt>
          <dd>{gold}</dd>
        </div>
        <div className="col-span-2 flex justify-between">
          <dt className="text-slate-400">EXP</dt>
          <dd>
            {exp} / {requiredExpForLevel(level)}
          </dd>
        </div>
      </dl>

      {lastLevelUp !== null && (
        <div className="mt-3 rounded-lg border border-amber-400/60 bg-amber-400/10 px-3 py-2 text-center text-sm font-semibold text-amber-300">
          Level up! You're now level {lastLevelUp}.
        </div>
      )}
    </div>
  )
}
