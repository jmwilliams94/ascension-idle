import { useEffect } from 'react'
import { MAX_CHARACTER_LEVEL, requiredExpForLevel, useProgressionStore } from '../game/stats/useProgressionStore'

// A persistent, always-visible compact readout of level/EXP/gold, shown in
// GameShell's top HUD strip across every tab (desktop and mobile alike).
//
// Absorbed ProgressionPanel entirely (confirmed with the user, 2026-08-02) —
// that card duplicated Level/EXP (already shown here) plus Gold in a
// separate box below this bar; removed as redundant, with Gold moved into
// this same row (rightmost) instead of losing it. The level-up toast
// ProgressionPanel used to own (a 2.2s auto-clearing notice) moved here too,
// rather than being silently dropped along with the rest of the card — it's
// a distinct celebratory moment, not just another restatement of the level
// number.
export default function ExpBar() {
  const gold = useProgressionStore((state) => state.gold)
  // Local combat-log predictions layered on top of the confirmed gold (see
  // useProgressionStore's predictedGold) so this bar moves in real time with
  // the log instead of sitting frozen until the next server confirmation.
  const predictedGold = useProgressionStore((state) => state.predictedGold)
  // predictedLevel/predictedExp (not the confirmed level/exp) drive the
  // whole Lv/bar/fraction display now (2026-08-05) — see
  // useProgressionStore's own comment on predictedLevel for why: the old
  // exp+predictedExp display was clamped at 100% of the *confirmed* level's
  // requirement, so it visually froze full for up to RESOLVE_INTERVAL_MS
  // once a player got close to leveling, reading as "no reward." These two
  // already roll all the way over into the next level locally, so there's
  // nothing left to clamp.
  const predictedLevel = useProgressionStore((state) => state.predictedLevel)
  const predictedExp = useProgressionStore((state) => state.predictedExp)
  const lastLevelUp = useProgressionStore((state) => state.lastLevelUp)
  const clearLevelUpNotice = useProgressionStore((state) => state.clearLevelUpNotice)
  const isMaxLevel = predictedLevel >= MAX_CHARACTER_LEVEL
  const required = requiredExpForLevel(predictedLevel)
  const displayedGold = gold + predictedGold
  const percent = isMaxLevel ? 100 : required > 0 ? Math.min(100, (predictedExp / required) * 100) : 100

  useEffect(() => {
    if (lastLevelUp === null) {
      return undefined
    }

    const timeout = setTimeout(() => clearLevelUpNotice(), 2200)
    return () => clearTimeout(timeout)
  }, [lastLevelUp, clearLevelUpNotice])

  return (
    <div className="relative flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-300 backdrop-blur lg:gap-3 lg:px-3 lg:py-2 lg:text-sm">
      {/* Larger than its siblings even at desktop — this is the number the
          user specifically flagged as too small to read at a glance. */}
      <span className="shrink-0 text-xs font-semibold lg:text-lg">Lv {predictedLevel}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800 lg:h-2">
        <div className={`h-full rounded-full ${isMaxLevel ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 text-slate-500">{isMaxLevel ? 'MAX' : `${predictedExp} / ${required}`}</span>
      <span className="shrink-0 border-l border-slate-700 pl-2 font-semibold text-amber-300 lg:pl-3">
        {displayedGold.toLocaleString()}g
      </span>

      {lastLevelUp !== null && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-amber-400/60 bg-amber-400/10 px-3 py-1.5 text-center text-xs font-semibold text-amber-300 backdrop-blur">
          Level up! You're now level {lastLevelUp}.
        </div>
      )}
    </div>
  )
}
