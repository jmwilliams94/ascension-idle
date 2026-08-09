import { useEffect } from 'react'
import { MAX_CHARACTER_LEVEL, requiredExpForLevel, useProgressionStore } from '../game/stats/useProgressionStore'
import { formatGoldAmount, goldColorClass } from '../game/stats/formatGold'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'

// Real art (2026-08-05), a user-supplied golden crystal cluster — Ascension
// Points had no icon anywhere before this (LuckyPanel/MarketplacePanel both
// show it as plain purple-tinted text). Same public/item-icons/ convention
// forgeCosts.ts's COMET_ICON_SRC/FALLEN_STAR_ICON_SRC already use, kept local
// to this file rather than added there since AP isn't an Inventory/Loot
// Holding tile the way Comets/Fallen Stars are — nothing else needs this
// constant yet.
const AP_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/ascension-points.png`

// A persistent, always-visible compact readout of level/EXP/gold/AP, shown in
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
//
// Ascension Points added (2026-08-05, confirmed with the user — "Can we add
// AP next to the gold in the same row as the exp bar?"), rightmost, its own
// border-l divider matching Gold's own. Reads usePlayerRecordStore directly
// (account-wide, not per-character — see CLAUDE.md's Marketplace section)
// rather than needing a predicted/local-running-total treatment the way
// Gold/EXP do, since nothing about live combat grants AP in real time —
// it's earned only from selling gear (Shop/Loot Holding), which already
// updates this store's value directly and immediately on its own.
export default function ExpBar() {
  const gold = useProgressionStore((state) => state.gold)
  const ascensionPoints = usePlayerRecordStore((state) => state.ascensionPoints)
  // Local combat-log predictions layered on top of the confirmed gold (see
  // useProgressionStore's predictedGold) so this bar moves in real time with
  // the log instead of sitting frozen until the next server confirmation.
  const predictedGold = useProgressionStore((state) => state.predictedGold)
  // predictedLevel/predictedExp (not the confirmed level/exp) drive the
  // whole Lv/bar/percentage display now (2026-08-05) — see
  // useProgressionStore's own comment on predictedLevel for why: the old
  // exp+predictedExp display was clamped at 100% of the *confirmed* level's
  // requirement, so it visually froze full for up to RESOLVE_INTERVAL_MS
  // once a player got close to leveling, reading as "no reward." These two
  // already roll all the way over into the next level locally, so there's
  // nothing left to clamp. Also deliberately underpredicted by a small
  // safety margin (see PREDICTED_EXP_SAFETY_FACTOR in useProgressionStore.ts)
  // so a server confirmation almost always corrects this percentage upward,
  // never down.
  //
  // Shown as a plain percentage (2026-08-05, confirmed with the user: "can
  // we also change the exp to show the percentage to the next level instead
  // of the existing long number? It should just read whatever it's at
  // 93.55%") — supersedes the earlier `${predictedExp} / ${required}`
  // fraction text. predictedExp/required are still computed below (needed
  // for the bar's own width via `percent`), just no longer shown as raw
  // numbers.
  const predictedLevel = useProgressionStore((state) => state.predictedLevel)
  const predictedExp = useProgressionStore((state) => state.predictedExp)
  const lastLevelUp = useProgressionStore((state) => state.lastLevelUp)
  const clearLevelUpNotice = useProgressionStore((state) => state.clearLevelUpNotice)
  const isMaxLevel = predictedLevel >= MAX_CHARACTER_LEVEL
  const required = requiredExpForLevel(predictedLevel)
  // predictedGold is a genuine float now (2026-08-11 expected-value rewrite
  // — see useProgressionStore's addPredictedRewards) since it accrues in
  // small per-tick fractions rather than kill-sized lumps; floored here,
  // display-only, same "floor at render time, not in the accumulator"
  // pattern the Achievements kill count uses.
  const displayedGold = Math.floor(gold + predictedGold)
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
      <span className="shrink-0 text-slate-500">{isMaxLevel ? 'MAX' : `${percent.toFixed(2)}%`}</span>
      <span className={`shrink-0 border-l border-slate-700 pl-2 font-semibold lg:pl-3 ${goldColorClass(displayedGold)}`}>
        {formatGoldAmount(displayedGold)}
      </span>
      <span className="flex shrink-0 items-center gap-1 border-l border-slate-700 pl-2 font-semibold text-purple-300 lg:pl-3">
        <img src={AP_ICON_SRC} alt="" className="h-3.5 w-3.5 object-contain lg:h-4 lg:w-4" />
        {ascensionPoints.toLocaleString()}
      </span>

      {lastLevelUp !== null && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-amber-400/60 bg-amber-400/10 px-3 py-1.5 text-center text-xs font-semibold text-amber-300 backdrop-blur">
          Level up! You're now level {lastLevelUp}.
        </div>
      )}
    </div>
  )
}
