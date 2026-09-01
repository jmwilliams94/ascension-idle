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
// ProgressionPanel used to own now lives in its own component,
// LevelUpBanner.tsx (moved out 2026-08-20, see that file's own comment for
// why) — mounted separately in GameShell, not rendered from here at all.
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
  // predictedLevel/predictedExp (not the confirmed level/exp) drive the
  // whole Lv/bar/percentage display — see useProgressionStore's own comment
  // on predictedLevel: originally a genuine per-attack prediction, now
  // (2026-11 reward-on-kill rewrite) just the last server-confirmed value,
  // kept as a separate field from level/exp rather than merged back in.
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
  const isMaxLevel = predictedLevel >= MAX_CHARACTER_LEVEL
  const required = requiredExpForLevel(predictedLevel)
  const displayedGold = Math.floor(gold)
  const percent = isMaxLevel ? 100 : required > 0 ? Math.min(100, (predictedExp / required) * 100) : 100

  return (
    <div className="ascension-chip-frame min-w-[240px] flex-1">
      <div className="ascension-chip-inner flex items-center gap-2 px-2 py-1 text-[10px] text-slate-300 lg:gap-3 lg:px-3 lg:py-2 lg:text-sm">
        {/* Larger than its siblings even at desktop — this is the number the
            user specifically flagged as too small to read at a glance. */}
        <span className="shrink-0 text-xs font-semibold lg:text-lg">Lv {predictedLevel}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800 lg:h-2">
          <div className={`h-full rounded-full ${isMaxLevel ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} />
        </div>
        <span className="shrink-0 text-slate-300">{isMaxLevel ? 'MAX' : `${percent.toFixed(2)}%`}</span>
        <span className={`shrink-0 border-l border-slate-700 pl-2 font-semibold lg:pl-3 ${goldColorClass(displayedGold)}`}>
          {formatGoldAmount(displayedGold)}
        </span>
        <span className="flex shrink-0 items-center gap-1 border-l border-slate-700 pl-2 font-semibold text-purple-300 lg:pl-3">
          <img src={AP_ICON_SRC} alt="" className="h-3.5 w-3.5 object-contain lg:h-4 lg:w-4" />
          {ascensionPoints.toLocaleString()}
        </span>
      </div>
    </div>
  )
}
