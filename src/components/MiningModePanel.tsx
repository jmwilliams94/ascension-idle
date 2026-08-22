import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { DeadOverlay, HpBar, hexColor } from './CombatPage'
import { MINES, MINE_ORDER, nodeForMine, type MineId } from '../game/mining/mineData'
import { useMineStore } from '../game/mining/useMineStore'
import { useMiningStore } from '../game/mining/useMiningStore'
import { useIdleModeStore } from '../game/mining/useIdleModeStore'
import { useCombatStore } from '../game/combat/useCombatStore'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { previewPickaxeTierUpgradeCost } from '../game/mining/pickaxeCosts'
import { tierUpgradePickaxe } from '../game/mining/pickaxeActions'
import { touchMiningLastResolvedAt } from '../game/mining/resolveMining'
import { formatItemDisplayName, getGearIconSrc, getQualityColor } from '../game/items/equipmentBonus'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { useGemStore } from '../game/items/useGemStore'
import { GEM_TYPES, formatGemTierLabel, gemCount, type GemTypeId } from '../game/items/gemCatalog'
import { formatGoldAmount } from '../game/stats/formatGold'

// Placeholder swatch color for every node — no real portrait art yet (see
// zoneData.ts's own hexColor(color) fallback precedent). A stony grey fits
// the "mining node" flavor better than the monster rosters' varied per-type
// colors would.
const NODE_SWATCH_COLOR = 0x8b8378

// Starting a mining session stops any active Hunting fight (and vice versa
// in CombatPage.tsx's handleFight) — Hunting and Mining can never both
// accrue progress, confirmed by the user. Calling useCombatStore.stop()
// triggers CombatEngine's own subscription-driven final resolve, closing out
// Hunting's own trailing window. That alone doesn't protect Mining's own
// pointer though — mining_last_resolved_at sits frozen the whole time
// Hunting was active, so without the touch call below, resuming Mining here
// would replay that entire Hunting session as a Mining catch-up (bug,
// reported by the user, fixed 2026-09-30 — see the migration's own comment).
function stopHuntingIfActive(characterId: string) {
  if (useCombatStore.getState().isFighting) {
    useCombatStore.getState().stop()
    void touchMiningLastResolvedAt(characterId)
  }
}

export default function MiningModePanel({ characterId }: { characterId: string }) {
  const currentMineId = useMineStore((state) => state.currentMineId)
  const setCurrentMineId = useMineStore((state) => state.setCurrentMineId)

  const isMining = useMiningStore((state) => state.isMining)
  const activeMineId = useMiningStore((state) => state.activeMineId)
  const currentHp = useMiningStore((state) => state.currentHp)
  const maxHp = useMiningStore((state) => state.maxHp)
  const respawnReadyAt = useMiningStore((state) => state.respawnReadyAt)
  const log = useMiningStore((state) => state.log)
  const start = useMiningStore((state) => state.start)
  const stop = useMiningStore((state) => state.stop)

  // Pickaxe is a normal Main Hand weapon now (requested by the user) — "is
  // one equipped" is derived live off the standard equipment/inventory/
  // template stores (equippedIds.weapon, checked against item_family)
  // rather than a separate equipped-pickaxe pointer/store.
  const weaponId = useEquipmentStore((state) => state.equippedIds.weapon)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const pickaxeItem = weaponId ? items.find((item) => item.id === weaponId) : undefined
  const pickaxeTemplate = pickaxeItem ? templates.find((t) => t.id === pickaxeItem.template_id) : undefined
  const equipped = Boolean(pickaxeTemplate && pickaxeTemplate.item_family === 'pickaxe')
  // Tier Up bumps quality_tier directly now (2026-09-30, requested by the
  // user — supersedes an earlier "5 separate templates" design), so the
  // display name uses the same qualityTier-prefix convention every other
  // gear tooltip does ("Tempered Pickaxe", plus a "(+N)" composition suffix)
  // rather than a raw template name.
  const displayName = equipped ? formatItemDisplayName(pickaxeTemplate!.name, pickaxeItem!.quality_tier, pickaxeItem!.composition_level) : 'Pickaxe'
  const ascendedGemType = useCharacterRecordStore((state) => state.pickaxeAscendedGemType) as GemTypeId | null

  const gold = useProgressionStore((state) => state.gold)
  const gems = useGemStore((state) => state.gems)

  const [now, setNow] = useState(0)
  const [tierUpgradeBusy, setTierUpgradeBusy] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [])

  const respawnSecondsLeft = respawnReadyAt > 0 ? Math.max(0, Math.ceil((respawnReadyAt - now) / 1000)) : 0
  const isRespawning = respawnSecondsLeft > 0

  const dropdownMineId = currentMineId ?? MINE_ORDER[0]

  const handleMine = (mineId: MineId) => {
    stopHuntingIfActive(characterId)
    useIdleModeStore.getState().setLastActiveIdleMode('mining')
    setCurrentMineId(mineId)
    start(mineId)
  }

  const handleToggle = () => {
    if (isMining) {
      stop()
    } else if (activeMineId && equipped) {
      // Guards the node card's own Resume button the same way the Mine
      // button above is disabled — without this, unequipping mid-session
      // (which stops mining) could be bypassed by tapping Resume here
      // instead of Mine.
      handleMine(activeMineId)
    }
  }

  const cost = previewPickaxeTierUpgradeCost(pickaxeItem?.quality_tier ?? 'normal', ascendedGemType)
  const canAffordGold = !cost || gold >= cost.goldCost
  const canAffordGems = !cost || cost.gemIds.every((gemId) => gemCount(gems, gemId, cost.gemTier) >= cost.gemAmountEach)
  const canAffordTierUp = canAffordGold && canAffordGems

  const handleTierUp = async () => {
    if (!cost || tierUpgradeBusy) return
    setTierUpgradeBusy(true)
    try {
      await tierUpgradePickaxe(characterId)
    } finally {
      setTierUpgradeBusy(false)
    }
  }

  const activeNode = activeMineId ? nodeForMine(activeMineId) : null

  return (
    <>
      <AscensionCard title="Zone & Mine">
        <div className="mt-2 flex flex-wrap gap-3">
          <label className="text-heading-label min-w-[140px] flex-1">
            Mine
            <Select value={dropdownMineId} onChange={(event) => setCurrentMineId(event.target.value as MineId)} className="mt-1">
              {MINE_ORDER.map((mineId) => {
                const mine = MINES[mineId]
                return (
                  <option key={mineId} value={mineId} disabled={mine.locked}>
                    {mine.displayName}
                    {mine.locked ? ' (coming soon)' : ''}
                  </option>
                )
              })}
            </Select>
          </label>
        </div>

        <Button
          variant="primary"
          disabled={!equipped || (isMining && activeMineId === dropdownMineId)}
          title={!equipped ? 'Equip a Pickaxe in your Main Hand slot first' : undefined}
          onClick={() => handleMine(dropdownMineId)}
          className="mt-3 w-full"
        >
          {isMining && activeMineId === dropdownMineId ? 'Mining' : 'Mine'}
        </Button>
      </AscensionCard>

      <AscensionCard title="Pickaxe">
        {!equipped ? (
          <p className="mt-2 text-xs text-slate-500">
            Equip a Pickaxe in your Main Hand slot (Inventory or Equipment page) to mine — buy one from the Shop's Weapons tab if you need one.
          </p>
        ) : (
          <>
            <div className="mt-2 flex items-center gap-2">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800"
                style={{ borderColor: getQualityColor(pickaxeItem!.quality_tier) }}
              >
                <img src={getGearIconSrc('Pickaxe', pickaxeItem!.quality_tier)} alt="" className="h-4/5 w-4/5 object-contain" />
              </div>
              <p className="text-sm font-medium text-slate-200">{displayName}</p>
            </div>

            {cost ? (
              <>
                <p className="mt-2 text-xs text-slate-500">
                  Tier up cost: {formatGoldAmount(cost.goldCost)} gold
                  {cost.gemIds.length > 0 && (
                    <>
                      {' + '}
                      {cost.gemIds
                        .map((gemId) => `${cost.gemAmountEach}x ${formatGemTierLabel(cost.gemTier)} ${GEM_TYPES[gemId].displayName}`)
                        .join(', ')}
                    </>
                  )}
                  {cost.gemIds.length === 0 && cost.gemTier === 'ascended' && ' (revealed on your first Ascended attempt)'}
                </p>
                <Button
                  variant="secondary"
                  disabled={!canAffordTierUp || tierUpgradeBusy}
                  onClick={() => void handleTierUp()}
                  className="mt-3 w-full"
                >
                  {tierUpgradeBusy ? 'Upgrading…' : 'Tier Up'}
                </Button>
              </>
            ) : (
              <p className="mt-2 text-xs text-emerald-400">Max tier reached.</p>
            )}
          </>
        )}
      </AscensionCard>

      {activeNode && (
        <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <div className="flex items-center gap-4">
            <div className="relative h-32 w-32 shrink-0">
              <div
                key={activeMineId}
                className={`h-32 w-32 rounded-2xl border-2 border-slate-700 transition-opacity ${isRespawning ? 'opacity-30 grayscale' : ''}`}
                style={{ backgroundColor: hexColor(NODE_SWATCH_COLOR) }}
              />
              {isRespawning && <DeadOverlay seconds={respawnSecondsLeft} label="Depleted" />}
              <AnimatePresence>
                {(now === 0
                  ? [] // `now` hasn't been initialized by the interval effect yet (very first
                    // render after mount) — without this guard, `0 - entry.timestamp` is a huge
                    // negative number for any past log entry, so every stale 'damage' entry still
                    // in useMiningStore.log (never cleared between sessions, same as
                    // useCombatStore's own log) matches `< 800` and flashes on screen for one
                    // frame every time this panel mounts — e.g. switching to the Mining tab.
                    // Mirrors CombatPage.tsx's own identical guard on its floatingNumbers.
                  : log.filter((entry) => entry.kind === 'damage' && now - entry.timestamp < 800)
                ).map((entry) => (
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
              <p className="truncate text-sm font-medium text-slate-200">{activeNode.displayName}</p>
              <p className="mt-1 text-xs text-slate-500">
                {isRespawning ? `Respawning in ${respawnSecondsLeft}s...` : `${currentHp} / ${maxHp} HP`}
              </p>
              <div className="mt-2">
                <HpBar current={isRespawning ? 0 : currentHp} max={maxHp} />
              </div>
            </div>
          </div>

          <Button
            variant="secondary"
            disabled={!isMining && !equipped}
            title={!isMining && !equipped ? 'Equip a Pickaxe in your Main Hand slot first' : undefined}
            onClick={handleToggle}
            className="mt-4 w-full"
          >
            {isMining ? 'Stop' : 'Resume'}
          </Button>
        </div>
      )}
    </>
  )
}
