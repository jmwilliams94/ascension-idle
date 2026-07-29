import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import CountUp from './CountUpNumber'
import InventoryPanel from './InventoryPanel'
import { ENEMY_TYPES, ZONES, ZONE_ORDER, type EnemyTypeId, type ZoneId } from '../game/zones/zoneData'
import { useZoneStore } from '../game/zones/useZoneStore'
import { useCombatStore, type CombatLogEntry } from '../game/combat/useCombatStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'

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
      return 'text-sky-300'
    case 'out-of-arrows':
      return 'text-red-400'
    default:
      return 'text-slate-400'
  }
}

function HpBar({ current, max }: { current: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0

  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
      <motion.div
        className="h-full rounded-full bg-emerald-500"
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 140, damping: 22 }}
      />
    </div>
  )
}

export default function CombatPage() {
  const currentZoneId = useZoneStore((state) => state.currentZoneId)
  const setCurrentZoneId = useZoneStore((state) => state.setCurrentZoneId)
  const setSelectedMonsterId = useZoneStore((state) => state.setSelectedMonsterId)

  const isFighting = useCombatStore((state) => state.isFighting)
  const monsterTypeId = useCombatStore((state) => state.monsterTypeId)
  const monsterInstanceKey = useCombatStore((state) => state.monsterInstanceKey)
  const currentHp = useCombatStore((state) => state.currentHp)
  const maxHp = useCombatStore((state) => state.maxHp)
  const isRareInstance = useCombatStore((state) => state.isRareInstance)
  const log = useCombatStore((state) => state.log)
  const start = useCombatStore((state) => state.start)
  const stop = useCombatStore((state) => state.stop)
  const clearCombat = useCombatStore((state) => state.clear)

  const gold = useProgressionStore((state) => state.gold)
  const exp = useProgressionStore((state) => state.exp)

  const [logExpanded, setLogExpanded] = useState(false)

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

  const activeType = monsterTypeId ? ENEMY_TYPES[monsterTypeId] : null
  const currentZone = ZONES[currentZoneId]

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
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <p className="text-sm font-medium text-slate-200">Zone</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ZONE_ORDER.map((zoneId) => {
              const zone = ZONES[zoneId]
              const isActive = zoneId === currentZoneId

              return (
                <button
                  key={zoneId}
                  type="button"
                  disabled={zone.locked}
                  onClick={() => handleSelectZone(zoneId)}
                  title={zone.locked ? 'Coming soon' : undefined}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    isActive
                      ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                      : zone.locked
                        ? 'cursor-not-allowed border-slate-800 text-slate-600'
                        : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {zone.displayName}
                  {zone.locked && ' 🔒'}
                </button>
              )
            })}
          </div>
        </div>

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
                <p className="text-sm font-medium text-slate-200">
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

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <p className="text-sm font-medium text-slate-200">{currentZone.displayName} — Enemy roster</p>
          {currentZone.monsterOrder.length === 0 && (
            <p className="mt-2 text-xs text-slate-500">This zone's roster hasn't been added yet — coming soon.</p>
          )}
          <ul className="mt-2 space-y-2 text-sm text-slate-400">
            {currentZone.monsterOrder.map((typeId) => {
              const type = ENEMY_TYPES[typeId]
              const isActive = monsterTypeId === typeId && isFighting

              return (
                <li
                  key={typeId}
                  className="flex items-center justify-between rounded-lg border border-slate-800/60 px-3 py-2"
                >
                  <div>
                    <span className="text-slate-200">{type.displayName}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {type.maxHp} HP · {type.goldReward}g · {type.expReward}xp
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleFight(typeId)}
                    disabled={isActive}
                    className="rounded-lg border border-emerald-700 px-3 py-1 text-xs font-medium text-emerald-300 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isActive ? 'Fighting' : 'Fight'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

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
  )
}
