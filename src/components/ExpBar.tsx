import { MAX_CHARACTER_LEVEL, requiredExpForLevel, useProgressionStore } from '../game/stats/useProgressionStore'

// A persistent, always-visible compact readout of level/EXP progress, separate
// from the fuller Progression card — shown in GameShell's top HUD strip across
// every tab now, rather than fixed to the bottom edge of the (now-removed) canvas.
export default function ExpBar() {
  const level = useProgressionStore((state) => state.level)
  const exp = useProgressionStore((state) => state.exp)
  const isMaxLevel = level >= MAX_CHARACTER_LEVEL
  const required = requiredExpForLevel(level)
  const percent = isMaxLevel ? 100 : required > 0 ? Math.min(100, (exp / required) * 100) : 100

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-300 backdrop-blur">
      <span className="shrink-0 font-semibold">Lv {level}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${isMaxLevel ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 text-slate-500">{isMaxLevel ? 'MAX' : `${exp} / ${required}`}</span>
    </div>
  )
}
