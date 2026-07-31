import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import CountUp from './CountUpNumber'
import InventoryPanel from './InventoryPanel'
import { ENEMY_TYPES, ZONES, ZONE_ORDER, type EnemyTypeId, type ZoneId } from '../game/zones/zoneData'
import { useZoneStore } from '../game/zones/useZoneStore'
import { useCombatStore, type CombatLogEntry } from '../game/combat/useCombatStore'
import { getLevelDiffColor } from '../game/combat/combatResolver'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { usePotionStore } from '../game/items/usePotionStore'
import { POTION_TYPES, HP_POTION_ORDER } from '../game/items/potionTypes'

// Matches getLevelDiffColor's tiers — White is an even match, Green means the
// character comfortably outlevels the monster (reduced EXP), Red/Black mean
// the monster outlevels the character (bonus EXP). "Black" can't literally be
// black text against this UI's dark background, so it uses the darkest shade
// that's still legible instead.
const LEVEL_DIFF_TEXT_CLASS: Record<string, string> = {
  white: 'text-slate-200',
  green: 'text-emerald-400',
  red: 'text-red-400',
  black: 'text-slate-500',
}

// Same White/Green/Red/Black convention, extended to the Zone/Monster picker
// dropdowns (2026-07-31, per the user's request) so a player can judge a
// zone or monster's fit before committing to Fight, not just after. <option>
// elements don't reliably respect Tailwind's generated utility classes across
// browsers the way a normal element does, so this is a plain inline hex map
// instead — same colors as LEVEL_DIFF_TEXT_CLASS, just usable via `style`.
const LEVEL_DIFF_HEX_COLOR: Record<string, string> = {
  white: '#e2e8f0',
  green: '#34d399',
  red: '#f87171',
  black: '#64748b',
}

// A zone spans a range of monster levels rather than having one level of its
// own — shown as "Lv min-max" in the picker, colored using the midpoint's
// level-diff (a reasonable "is this zone roughly where I'm at" signal, not
// meant to be exact for every monster inside it).
function zoneLevelRange(zone: { monsterOrder: EnemyTypeId[] }): { min: number; max: number; mid: number } | null {
  if (zone.monsterOrder.length === 0) {
    return null
  }
  const levels = zone.monsterOrder.map((id) => ENEMY_TYPES[id].level)
  const min = Math.min(...levels)
  const max = Math.max(...levels)
  return { min, max, mid: Math.round((min + max) / 2) }
}

// Enemy colors are stored as 0xRRGGBB numbers (a Phaser-era convention, kept as-is
// since nothing else about EnemyTypeDef needed to change) — this is the one spot
// that converts to a CSS hex string for the placeholder portrait swatch.
function hexColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`
}

// How long a floating damage number stays visible after its log entry lands.
const FLOATING_NUMBER_LIFETIME_MS = 800

function logLineClass(kind: CombatLogEntry['kind']): string {
  switch (kind) {
    case 'kill':
      return 'text-emerald-400'
    case 'rare-kill':
      return 'text-amber-300 font-semibold'
    case 'item':
    case 'currency':
      return 'text-sky-300'
    case 'no-quiver':
    case 'knockout':
      return 'text-red-400'
    case 'player-damage':
      return 'text-rose-400'
    case 'dodge':
      return 'text-cyan-300'
    default:
      return 'text-slate-400'
  }
}

function HpBar({ current, max, barColorClass = 'bg-emerald-500' }: { current: number; max: number; barColorClass?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0

  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
      <motion.div
        className={`h-full rounded-full ${barColorClass}`}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 140, damping: 22 }}
      />
    </div>
  )
}

export default function CombatPage() {
  const currentZoneId = useZoneStore((state) => state.currentZoneId)
  const setCurrentZoneId = useZoneStore((state) => state.setCurrentZoneId)
  const selectedMonsterId = useZoneStore((state) => state.selectedMonsterId)
  const setSelectedMonsterId = useZoneStore((state) => state.setSelectedMonsterId)

  const isFighting = useCombatStore((state) => state.isFighting)
  const monsterTypeId = useCombatStore((state) => state.monsterTypeId)
  const monsterInstanceKey = useCombatStore((state) => state.monsterInstanceKey)
  const currentHp = useCombatStore((state) => state.currentHp)
  const maxHp = useCombatStore((state) => state.maxHp)
  const currentPlayerHp = useCombatStore((state) => state.currentPlayerHp)
  const maxPlayerHp = useCombatStore((state) => state.maxPlayerHp)
  const isRareInstance = useCombatStore((state) => state.isRareInstance)
  const log = useCombatStore((state) => state.log)
  const start = useCombatStore((state) => state.start)
  const stop = useCombatStore((state) => state.stop)
  const clearCombat = useCombatStore((state) => state.clear)

  const gold = useProgressionStore((state) => state.gold)
  const exp = useProgressionStore((state) => state.exp)
  const characterLevel = useProgressionStore((state) => state.level)
  const characterName = useCharacterRecordStore((state) => state.characterName)

  const potionStacks = usePotionStore((state) => state.stacks)
  const handleUsePotion = usePotionStore((state) => state.usePotion)

  const [logExpanded, setLogExpanded] = useState(false)
  // Mobile-only (see the lg:hidden layout below) — Inventory defaults collapsed
  // there so the action area (monster/player HP, Fight/Stop) is what's visible
  // without scrolling, matching the Combat Log's existing collapse convention.
  const [inventoryExpanded, setInventoryExpanded] = useState(false)

  // Floating damage numbers are derived from the log itself (recent 'damage'
  // entries, by timestamp) rather than tracked as their own state — avoids
  // synchronously deriving state inside an effect. `now` is only ever read/written
  // from the interval's effect callback (never called directly during render, which
  // React's purity rules disallow) so the numbers actually disappear
  // ~FLOATING_NUMBER_LIFETIME_MS after landing instead of lingering until the next
  // unrelated re-render.
  const [now, setNow] = useState(0)

  useEffect(() => {
    // Only ever set from this timer callback (an external clock), never directly
    // in the effect body itself — the first tick lands ~200ms after mount, which
    // is an acceptable brief gap before floating numbers can appear.
    const id = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [])

  const floatingNumbers =
    now === 0
      ? [] // `now` hasn't been initialized by the interval effect yet (very first render) —
        // treat as "nothing recent" rather than matching every entry against a stale `now`.
      : log.filter(
          (entry): entry is CombatLogEntry & { amount: number } =>
            entry.kind === 'damage' && typeof entry.amount === 'number' && now - entry.timestamp < FLOATING_NUMBER_LIFETIME_MS,
        )

  const playerFloatingNumbers =
    now === 0
      ? []
      : log.filter(
          (entry): entry is CombatLogEntry & { amount: number } =>
            entry.kind === 'player-damage' &&
            typeof entry.amount === 'number' &&
            now - entry.timestamp < FLOATING_NUMBER_LIFETIME_MS,
        )

  const activeType = monsterTypeId ? ENEMY_TYPES[monsterTypeId] : null
  const currentZone = ZONES[currentZoneId]

  // "Best available" HP potion (confirmed with the user, 2026-07-31) — the
  // highest-tier owned stack with any left, so the strongest potion is
  // always the one surfaced here rather than whichever happens to sit first
  // in Inventory. Mana potions are deliberately skipped — they're inert
  // (nothing consumes MP yet), so there's nothing useful to surface here.
  let bestHpPotionStack: (typeof potionStacks)[number] | null = null
  for (let i = HP_POTION_ORDER.length - 1; i >= 0; i -= 1) {
    const found = potionStacks.find((stack) => stack.potionType === HP_POTION_ORDER[i] && stack.count > 0)
    if (found) {
      bestHpPotionStack = found
      break
    }
  }
  const dropdownMonsterId = selectedMonsterId ?? currentZone.monsterOrder[0] ?? null

  const handleFight = (typeId: EnemyTypeId) => {
    setSelectedMonsterId(typeId)
    start(typeId)
  }

  const handleToggle = () => {
    if (isFighting) {
      stop()
    } else if (monsterTypeId) {
      handleFight(monsterTypeId)
    }
  }

  const handleSelectZone = (zoneId: ZoneId) => {
    if (ZONES[zoneId].locked || zoneId === currentZoneId) {
      return
    }
    clearCombat()
    setCurrentZoneId(zoneId)
  }

  return (
    <>
      {/* Mobile-only layout (below `lg`) — action area (monster/player HP,
          Fight/Stop, Consumable) prioritized at the top since that's what's
          looked at moment-to-moment; Zone/Monster picker below it (still
          always reachable, just not the first thing on screen); Inventory and
          Combat Log both collapsed by default so the initial view is short
          enough to not require scrolling on a phone. No Gold/EXP row here —
          ProgressionPanel (GameShell's persistent top strip, shown above every
          tab) already covers that, so repeating it here would just be more
          scroll for nothing. Desktop's layout (below) is untouched — this is
          entirely separate markup, not a responsive reflow of the same JSX, so
          nothing here can regress the desktop view. */}
      <div className="space-y-3 lg:hidden">
        {activeType && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="flex items-center gap-4">
              <div className="relative h-16 w-16 shrink-0">
                <div
                  key={monsterInstanceKey}
                  className={`h-16 w-16 rounded-2xl border-2 border-slate-700 ${isRareInstance ? 'super-quality-glow' : ''}`}
                  style={{ backgroundColor: hexColor(activeType.color) }}
                />
                <AnimatePresence>
                  {floatingNumbers.map((entry) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 1, y: 0 }}
                      animate={{ opacity: 0, y: -32 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 text-sm font-bold text-amber-300"
                    >
                      -{entry.amount}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${LEVEL_DIFF_TEXT_CLASS[getLevelDiffColor(characterLevel, activeType.level)]}`}>
                  {activeType.displayName}
                  {isRareInstance && <span className="ml-2 text-xs font-bold text-amber-300">RARE</span>}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {currentHp} / {maxHp} HP
                </p>
                <div className="mt-2">
                  <HpBar current={currentHp} max={maxHp} />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggle}
              className="mt-4 w-full rounded-lg border border-slate-700 py-2.5 text-sm font-medium text-slate-200 hover:border-slate-500"
            >
              {isFighting ? 'Stop' : 'Resume'}
            </button>
          </div>
        )}

        {activeType && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <p className="text-xs font-medium text-slate-400">{characterName}</p>
            <div className="relative mt-1">
              <p className="text-xs text-slate-500">
                {currentPlayerHp} / {maxPlayerHp} HP
              </p>
              <div className="mt-1">
                <HpBar current={currentPlayerHp} max={maxPlayerHp} barColorClass="bg-rose-500" />
              </div>
              <AnimatePresence>
                {playerFloatingNumbers.map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 1, y: 0 }}
                    animate={{ opacity: 0, y: -20 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="pointer-events-none absolute right-0 top-0 text-sm font-bold text-rose-300"
                  >
                    -{entry.amount}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
              {bestHpPotionStack ? (
                <>
                  <span className="flex min-w-0 items-center gap-2 text-slate-200">
                    <span className="shrink-0 text-base">🧪</span>
                    <span className="truncate">
                      {POTION_TYPES[bestHpPotionStack.potionType].displayName} ({bestHpPotionStack.count})
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={maxPlayerHp > 0 && currentPlayerHp >= maxPlayerHp}
                    onClick={() => void handleUsePotion(bestHpPotionStack!.id)}
                    className="shrink-0 rounded border border-sky-500 bg-sky-500/10 px-3 py-1.5 font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600"
                  >
                    {maxPlayerHp > 0 && currentPlayerHp >= maxPlayerHp ? 'HP full' : 'Use'}
                  </button>
                </>
              ) : (
                <span className="text-slate-600">No HP potions — visit the Shop</span>
              )}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <p className="text-sm font-medium text-slate-200">Zone &amp; Monster</p>

          <div className="mt-2 flex flex-wrap gap-3">
            <label className="min-w-[140px] flex-1 text-xs text-slate-400">
              Zone
              <select
                value={currentZoneId}
                onChange={(event) => handleSelectZone(event.target.value as ZoneId)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-200"
              >
                {ZONE_ORDER.map((zoneId) => {
                  const zone = ZONES[zoneId]
                  const range = zoneLevelRange(zone)
                  return (
                    <option
                      key={zoneId}
                      value={zoneId}
                      disabled={zone.locked}
                      style={range ? { color: LEVEL_DIFF_HEX_COLOR[getLevelDiffColor(characterLevel, range.mid)] } : undefined}
                    >
                      {zone.displayName}
                      {range ? ` (Lv ${range.min}-${range.max})` : ''}
                      {zone.locked ? ' (coming soon)' : ''}
                    </option>
                  )
                })}
              </select>
            </label>

            <label className="min-w-[140px] flex-1 text-xs text-slate-400">
              Monster
              <select
                value={dropdownMonsterId ?? ''}
                disabled={currentZone.monsterOrder.length === 0}
                onChange={(event) => setSelectedMonsterId(event.target.value as EnemyTypeId)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {currentZone.monsterOrder.length === 0 ? (
                  <option value="">Coming soon</option>
                ) : (
                  currentZone.monsterOrder.map((typeId) => {
                    const type = ENEMY_TYPES[typeId]
                    return (
                      <option key={typeId} value={typeId} style={{ color: LEVEL_DIFF_HEX_COLOR[getLevelDiffColor(characterLevel, type.level)] }}>
                        {type.displayName} (Lv {type.level})
                      </option>
                    )
                  })
                )}
              </select>
            </label>
          </div>

          <button
            type="button"
            disabled={!dropdownMonsterId || (isFighting && monsterTypeId === dropdownMonsterId)}
            onClick={() => dropdownMonsterId && handleFight(dropdownMonsterId)}
            className="mt-3 w-full rounded-lg border border-emerald-700 py-2.5 text-sm font-medium text-emerald-300 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isFighting && monsterTypeId === dropdownMonsterId ? 'Fighting' : 'Fight'}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <button
            type="button"
            onClick={() => setInventoryExpanded((value) => !value)}
            className="flex w-full items-center justify-between text-left"
          >
            <p className="text-sm font-medium text-slate-200">Inventory</p>
            <span className="text-xs text-slate-400">{inventoryExpanded ? 'Hide ▲' : 'Show ▼'}</span>
          </button>

          {inventoryExpanded && (
            <div className="mt-3">
              <InventoryPanel columns={5} />
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <button
            type="button"
            onClick={() => setLogExpanded((value) => !value)}
            className="flex w-full items-center justify-between text-left"
          >
            <p className="text-sm font-medium text-slate-200">Combat Log</p>
            <span className="text-xs text-slate-400">{logExpanded ? 'Hide ▲' : 'Show ▼'}</span>
          </button>

          {logExpanded && (
            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto text-xs">
              <AnimatePresence initial={false}>
                {log.length === 0 && (
                  <p key="empty" className="text-slate-600">
                    Pick a monster from the roster to start fighting.
                  </p>
                )}
                {log.map((entry) => (
                  <motion.p
                    key={entry.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className={logLineClass(entry.kind)}
                  >
                    {entry.message}
                  </motion.p>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Desktop layout (`lg` and up) — unchanged from before this step. */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <p className="text-sm font-medium text-slate-200">Zone &amp; Monster</p>

          <div className="mt-2 flex flex-wrap gap-3">
            <label className="flex-1 min-w-[160px] text-xs text-slate-400">
              Zone
              <select
                value={currentZoneId}
                onChange={(event) => handleSelectZone(event.target.value as ZoneId)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
              >
                {ZONE_ORDER.map((zoneId) => {
                  const zone = ZONES[zoneId]
                  const range = zoneLevelRange(zone)
                  return (
                    <option
                      key={zoneId}
                      value={zoneId}
                      disabled={zone.locked}
                      style={range ? { color: LEVEL_DIFF_HEX_COLOR[getLevelDiffColor(characterLevel, range.mid)] } : undefined}
                    >
                      {zone.displayName}
                      {range ? ` (Lv ${range.min}-${range.max})` : ''}
                      {zone.locked ? ' (coming soon)' : ''}
                    </option>
                  )
                })}
              </select>
            </label>

            <label className="flex-1 min-w-[160px] text-xs text-slate-400">
              Monster
              <select
                value={dropdownMonsterId ?? ''}
                disabled={currentZone.monsterOrder.length === 0}
                onChange={(event) => setSelectedMonsterId(event.target.value as EnemyTypeId)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {currentZone.monsterOrder.length === 0 ? (
                  <option value="">Coming soon</option>
                ) : (
                  currentZone.monsterOrder.map((typeId) => {
                    const type = ENEMY_TYPES[typeId]
                    return (
                      <option key={typeId} value={typeId} style={{ color: LEVEL_DIFF_HEX_COLOR[getLevelDiffColor(characterLevel, type.level)] }}>
                        {type.displayName} (Lv {type.level})
                      </option>
                    )
                  })
                )}
              </select>
            </label>
          </div>

          <button
            type="button"
            disabled={!dropdownMonsterId || (isFighting && monsterTypeId === dropdownMonsterId)}
            onClick={() => dropdownMonsterId && handleFight(dropdownMonsterId)}
            className="mt-3 w-full rounded-lg border border-emerald-700 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isFighting && monsterTypeId === dropdownMonsterId ? 'Fighting' : 'Fight'}
          </button>
        </div>

        {activeType && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <p className="text-xs font-medium text-slate-400">{characterName}</p>
            <div className="relative mt-1">
              <p className="text-xs text-slate-500">
                {currentPlayerHp} / {maxPlayerHp} HP
              </p>
              <div className="mt-1">
                <HpBar current={currentPlayerHp} max={maxPlayerHp} barColorClass="bg-rose-500" />
              </div>
              <AnimatePresence>
                {playerFloatingNumbers.map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 1, y: 0 }}
                    animate={{ opacity: 0, y: -20 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="pointer-events-none absolute right-0 top-0 text-sm font-bold text-rose-300"
                  >
                    -{entry.amount}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Consumable slot (confirmed with the user, 2026-07-31) — surfaces the
                best (highest-tier) owned HP potion right on the Combat page so
                healing mid-fight doesn't require leaving to the Inventory grid. */}
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
              {bestHpPotionStack ? (
                <>
                  <span className="flex min-w-0 items-center gap-2 text-slate-200">
                    <span className="shrink-0 text-base">🧪</span>
                    <span className="truncate">
                      {POTION_TYPES[bestHpPotionStack.potionType].displayName} ({bestHpPotionStack.count})
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={maxPlayerHp > 0 && currentPlayerHp >= maxPlayerHp}
                    onClick={() => void handleUsePotion(bestHpPotionStack!.id)}
                    className="shrink-0 rounded border border-sky-500 bg-sky-500/10 px-2 py-1 font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600"
                  >
                    {maxPlayerHp > 0 && currentPlayerHp >= maxPlayerHp ? 'HP full' : 'Use'}
                  </button>
                </>
              ) : (
                <span className="text-slate-600">No HP potions — visit the Shop</span>
              )}
            </div>
          </div>
        )}

        {activeType && (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="flex items-center gap-4">
              <div className="relative h-20 w-20 shrink-0">
                <div
                  key={monsterInstanceKey}
                  className={`h-20 w-20 rounded-2xl border-2 border-slate-700 ${isRareInstance ? 'super-quality-glow' : ''}`}
                  style={{ backgroundColor: hexColor(activeType.color) }}
                />
                <AnimatePresence>
                  {floatingNumbers.map((entry) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 1, y: 0 }}
                      animate={{ opacity: 0, y: -32 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 text-sm font-bold text-amber-300"
                    >
                      -{entry.amount}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              <div className="flex-1">
                <p className={`text-sm font-medium ${LEVEL_DIFF_TEXT_CLASS[getLevelDiffColor(characterLevel, activeType.level)]}`}>
                  {activeType.displayName}
                  {isRareInstance && <span className="ml-2 text-xs font-bold text-amber-300">RARE</span>}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {currentHp} / {maxHp} HP
                </p>
                <div className="mt-2">
                  <HpBar current={currentHp} max={maxHp} />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggle}
              className="mt-4 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
            >
              {isFighting ? 'Stop' : 'Resume'}
            </button>
          </div>
        )}

        {/* Collapsed by default — the roster/fight panel above is the primary
            view; the log is a detail view for players who want to see individual
            hits, matching StatsPanel's collapse convention elsewhere. */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <button
            type="button"
            onClick={() => setLogExpanded((value) => !value)}
            className="flex w-full items-center justify-between text-left"
          >
            <p className="text-sm font-medium text-slate-200">Combat Log</p>
            <span className="text-xs text-slate-400">{logExpanded ? 'Hide ▲' : 'Show ▼'}</span>
          </button>

          {logExpanded && (
            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto text-xs">
              <AnimatePresence initial={false}>
                {log.length === 0 && (
                  <p key="empty" className="text-slate-600">
                    Pick a monster from the roster to start fighting.
                  </p>
                )}
                {log.map((entry) => (
                  <motion.p
                    key={entry.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className={logLineClass(entry.kind)}
                  >
                    {entry.message}
                  </motion.p>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-xs text-slate-400">
          <span>
            Gold:{' '}
            <CountUp end={gold} duration={0.6} preserveValue className="font-semibold text-amber-300" />
          </span>
          <span>
            EXP: <CountUp end={exp} duration={0.6} preserveValue className="font-semibold text-sky-300" />
          </span>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <InventoryPanel columns={5} />
        </div>
      </div>
      </div>
    </>
  )
}
