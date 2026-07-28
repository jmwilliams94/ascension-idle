import { requiredExpForLevel, useProgressionStore } from '../game/stats/useProgressionStore'

// Fixed to the bottom edge of GameCanvas (see GameShell's relative wrapper) —
// a persistent, always-visible readout of level/EXP progress, separate from the
// Progression card in the side HUD.
export default function ExpBar() {
  const level = useProgressionStore((state) => state.level)
  const exp = useProgressionStore((state) => state.exp)
  const required = requiredExpForLevel(level)
  const percent = required > 0 ? Math.min(100, (exp / required) * 100) : 100

  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 px-2 pb-2">
      <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-300 backdrop-blur">
        <span className="shrink-0 font-semibold">Lv {level}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
        </div>
        <span className="shrink-0 text-slate-500">
          {exp} / {required}
        </span>
      </div>
    </div>
  )
}
