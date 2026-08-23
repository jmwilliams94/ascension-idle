import { useEffect } from 'react'
import CountUp from './CountUpNumber'
import InventorySlot from './InventorySlot'
import LootHoldingCard from './LootHoldingCard'
import { Button } from './ui/Button'
import { useOfflineProgressStore } from '../game/combat/useOfflineProgressStore'
import { useLootHoldingStore } from '../game/items/useLootHoldingStore'
import { useLootHoldingModalStore } from '../game/items/useLootHoldingModalStore'
import { useZoneStore } from '../game/zones/useZoneStore'
import { ENEMY_TYPES } from '../game/zones/zoneData'
import type { VipAutomationSummary } from '../game/vip/vipAutomationSummary'
import { formatGoldAmount } from '../game/stats/formatGold'
import { GEM_TIERS, GEM_TYPE_ORDER, GEM_TYPES, formatGemTierLabel, getGemIconSrc, getGemTierColor, parseGemStorageKey } from '../game/items/gemTypes'

// One real-icon tile + count, for a "what currency/materials did I actually
// find" row — reuses the same InventorySlot tile every other grid in the
// game renders items with, rather than a plain "+N" text line. Used for
// Hunting's Comet find and Mining's per-gem-type/tier finds.
function FindTile({ iconSrc, color, label, count }: { iconSrc: string; color: string; label: string; count: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <InventorySlot slotId={`find-${label}`} filled iconSrc={iconSrc} qualityColor={color} badge={`${count}`} sizeClassName="h-10 w-10" label={label} />
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  )
}

function FindTileRow({ tiles }: { tiles: { key: string; iconSrc: string; color: string; label: string; count: number }[] }) {
  if (tiles.length === 0) {
    return null
  }
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      {tiles.map((tile) => (
        <FindTile key={tile.key} iconSrc={tile.iconSrc} color={tile.color} label={tile.label} count={tile.count} />
      ))}
    </div>
  )
}

// Groups Mining's per-gemKey ("drake_normal") breakdown into displayable
// tiles, sorted by tier then gem type so the row reads consistently across
// away-sessions rather than shuffling with object key order.
function buildGemTiles(gemsGranted: Record<string, number> | undefined): { key: string; iconSrc: string; color: string; label: string; count: number }[] {
  if (!gemsGranted) {
    return []
  }
  return Object.entries(gemsGranted)
    .map(([key, count]) => {
      const parsed = parseGemStorageKey(key)
      if (!parsed || count <= 0) {
        return null
      }
      const { gemId, tier } = parsed
      return {
        key,
        iconSrc: getGemIconSrc(gemId, tier),
        color: getGemTierColor(tier),
        label: `${formatGemTierLabel(tier)} ${GEM_TYPES[gemId].displayName}`,
        count,
        tierRank: GEM_TIERS.indexOf(tier),
        typeRank: GEM_TYPE_ORDER.indexOf(gemId),
      }
    })
    .filter((tile): tile is NonNullable<typeof tile> => tile !== null)
    .sort((a, b) => a.tierRank - b.tierRank || a.typeRank - b.typeRank)
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

// One "Auto-Salvaging / +21 AP" row within VipAutomationSummarySection below.
function VipAutomationRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm font-semibold text-amber-200">
        {value} <span className="font-normal text-slate-500">{detail}</span>
      </p>
    </div>
  )
}

// Shown below either mode's own stat grid when the away-window had any VIP
// automation activity (see runVipAutomationPass.ts) — the "breakdown of what
// auto-sold" the user asked for after a real bug where Ore sat unsold in
// Loot Holding with nothing telling them why. Each action gets its own
// labeled row (requested by the user, after the first pass's bulleted-
// sentence version) rather than a single line of prose.
function VipAutomationSummarySection({ summary }: { summary: VipAutomationSummary }) {
  return (
    <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-sm font-semibold text-amber-300">👑 VIP Automations</p>
      <div className="space-y-2.5">
        {summary.itemsSalvagedCount > 0 && (
          <VipAutomationRow
            label="Auto-Salvaging"
            value={`+${summary.apGained} AP`}
            detail={`(${summary.itemsSalvagedCount} item${summary.itemsSalvagedCount === 1 ? '' : 's'})`}
          />
        )}
        {summary.oreSoldCount > 0 && (
          <VipAutomationRow
            label="Auto-Selling"
            value={`${formatGoldAmount(summary.oreGoldGained)} gold`}
            detail={`(${summary.oreSoldCount} Ore)`}
          />
        )}
        {summary.itemsSoldCount > 0 && (
          <VipAutomationRow
            label="Auto-Selling Gear"
            value={`${formatGoldAmount(summary.gearGoldGained)} gold`}
            detail={`(${summary.itemsSoldCount} item${summary.itemsSoldCount === 1 ? '' : 's'})`}
          />
        )}
        {summary.itemsBankedCount > 0 && (
          <VipAutomationRow
            label="Auto-Banking"
            value={`+${summary.compositionPointsGained} Composition Points`}
            detail={`(${summary.itemsBankedCount} item${summary.itemsBankedCount === 1 ? '' : 's'})`}
          />
        )}
      </div>
    </div>
  )
}

// Shown after a load resolves a nonzero offline-progress result (see
// runOfflineProgressCheck, called from GameShell) — the "Welcome back"
// mode — or when UnclaimedLootBadge's fallback button is tapped (the
// "Unclaimed rewards" mode). Renders nothing otherwise, so it's safe to
// mount unconditionally.
// Loot Holding moved here entirely (2026-07-31, per the user's request) —
// it's no longer a persistent Warehouse card, it's exclusively an "idle
// rewards" interface now (see LootHoldingCard's own note, and CLAUDE.md's
// Loot section). Live play never populates it at all anymore (a full
// Inventory during active combat stops the fight instead — see
// useCombatStore.stopForInventoryFull/InventoryFullWarningHud); the offline/
// idle-progress simulator is its only remaining source.
//
// Reworked (2026-08-05, confirmed with the user: "I need it to prompt first
// with hey welcome back... anything after that is likely not necessary" /
// "make sure the first thing that pops up is the correct idle rewards popup
// and no other nonsense") — supersedes the earlier "shows itself
// automatically whenever any unclaimed entries exist" behavior:
// - Visibility is driven by two explicit signals only — a fresh `result`,
//   or useLootHoldingModalStore's own `open` flag (set by
//   UnclaimedLootBadge) — never just "entries happen to exist." That auto-
//   show was the actual source of a previously-reported "a similar or exact
//   same popup happens again" bug.
//
// Bottom button simplified back to a plain, always-available dismiss
// (2026-08-07) — supersedes the 2026-08-05 "stays open and loops Claim on
// every remaining entry, forcing the player to resolve everything before
// closing" behavior. That forcing was a workaround for Claim being the only
// way off this screen; now that LootHoldingCard's own staged Claim/Store/
// Sell flow (see that file) guarantees a real, always-available way to
// resolve anything left (Store bypasses Inventory's cap entirely), the
// modal no longer needs to hold the player hostage to a bulk claim
// succeeding — "Got it" just closes, and UnclaimedLootBadge's 🎁 button
// remains the way back to anything still unresolved.
//
// The brief "Checking what happened while you were away…" spinner that used
// to cover the round trip to runOfflineProgressCheck was removed (Pete's
// request) — the check itself is unaffected, this modal just no longer shows
// anything while it's in flight; only its eventual result (or a sync
// failure) still pops up.
export default function OfflineProgressModal() {
  const result = useOfflineProgressStore((state) => state.result)
  const miningResult = useOfflineProgressStore((state) => state.miningResult)
  const syncFailed = useOfflineProgressStore((state) => state.syncFailed)
  const dismissResult = useOfflineProgressStore((state) => state.dismiss)
  const selectedMonsterId = useZoneStore((state) => state.selectedMonsterId)
  const lootHoldingCount = useLootHoldingStore((state) => state.entries.length)
  const manuallyOpened = useLootHoldingModalStore((state) => state.open)
  const closeManualModal = useLootHoldingModalStore((state) => state.closeModal)

  // Bug fix (reported by the user — an empty "Unclaimed rewards" shell,
  // just the title and "Got it", with nothing in it): the "Unclaimed
  // rewards" mode (manuallyOpened, no result/syncFailed) has nothing of its
  // own to show — its entire content is LootHoldingCard, gated on
  // lootHoldingCount > 0 further down. Claiming/Storing/Selling everything
  // while this modal is open drops that count to 0, LootHoldingCard stops
  // rendering, but nothing previously closed the modal itself — it just sat
  // there empty until manually dismissed. Auto-close the instant that
  // happens instead. Doesn't touch the 'result'/'syncFailed' modes, which
  // always have their own content regardless of Loot Holding's count.
  useEffect(() => {
    if (manuallyOpened && !result && !miningResult && !syncFailed && lootHoldingCount === 0) {
      closeManualModal()
    }
  }, [manuallyOpened, result, miningResult, syncFailed, lootHoldingCount, closeManualModal])

  if (!result && !miningResult && !manuallyOpened && !syncFailed) {
    return null
  }

  const type = result && selectedMonsterId ? ENEMY_TYPES[selectedMonsterId] : null
  const vipSummary = result?.vipSummary ?? miningResult?.vipSummary
  const gemTiles = miningResult ? buildGemTiles(miningResult.gemsGranted) : []

  const handleClose = () => {
    dismissResult()
    closeManualModal()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      {/* max-h + overflow-y-auto — the backdrop is a fixed, non-scrolling
          viewport-filling flex container, so without a height cap and its own
          scroll the card just overflows past the screen edge on a phone with
          no way to reach whatever's below the fold (Loot Holding's grid,
          bulk-action bar, detail card, even the "Got it" button itself). */}
      <div className="ascension-card-frame w-full max-w-md">
      <div className="ascension-card-inner max-h-[90vh] space-y-4 overflow-y-auto p-5">
        {syncFailed ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="text-2xl">👋</span>
            <h2 className="text-lg font-semibold text-white">Welcome back</h2>
            <p className="text-sm text-slate-400">
              We couldn&apos;t confirm what happened while you were away. Nothing is lost — it&apos;ll be caught up
              automatically the next time you play.
            </p>
            <Button variant="primary" onClick={handleClose} className="w-full">
              Got it
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <span className="text-2xl">{result || miningResult ? '👋' : '📦'}</span>
              <div>
                <h2 className="text-lg font-semibold text-white">{result || miningResult ? 'Welcome back' : 'Unclaimed rewards'}</h2>
                {result && type && (
                  <p className="mt-1 text-sm text-slate-400">
                    While you were away ({formatDuration(result.elapsedMs)}), your character kept fighting {type.displayName}.
                  </p>
                )}
                {miningResult && (
                  <p className="mt-1 text-sm text-slate-400">
                    While you were away ({formatDuration(miningResult.elapsedMs)}), your character kept mining
                    {miningResult.nodeDisplayName ? ` ${miningResult.nodeDisplayName}` : ''}.
                  </p>
                )}
              </div>
            </div>

            {result && result.petObtained && (
              <div className="relative rounded-xl border border-amber-400 bg-amber-500/10 p-3 text-center shadow-lg shadow-amber-500/20">
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-slate-950">
                  NEW PET
                </span>
                <p className="mt-1 text-sm font-semibold text-amber-300">
                  🎉 You obtained the {result.petObtained} pet while you were away!
                </p>
              </div>
            )}

            {result && result.fallenStars > 0 && (
              <div className="relative rounded-xl border border-violet-400 bg-violet-500/10 p-3 text-center shadow-lg shadow-violet-500/20">
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-violet-500 px-1.5 py-0.5 text-[9px] font-bold text-slate-950">
                  RARE DROP
                </span>
                <p className="mt-1 text-sm font-semibold text-violet-300">
                  ✨ A Fallen Star dropped while you were away! (+{result.fallenStars})
                </p>
              </div>
            )}

            {result && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
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
                {result.itemsFoundCount > 0 && (
                  <div className="col-span-2 flex justify-between">
                    <dt className="text-slate-400">Items found</dt>
                    <dd>{result.itemsFoundCount}</dd>
                  </div>
                )}
                {result.comets > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Comets</dt>
                    <dd className="font-semibold text-slate-200">+{result.comets}</dd>
                  </div>
                )}
              </dl>
            )}

            {miningResult && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300">
                <div className="flex justify-between">
                  <dt className="text-slate-400">Nodes mined</dt>
                  <dd>{miningResult.kills}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Ore</dt>
                  <dd className="font-semibold text-slate-200">+{miningResult.ore}</dd>
                </div>
                {miningResult.umbriteOre > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Umbrite Ore</dt>
                    <dd className="font-semibold text-amber-300">+{miningResult.umbriteOre}</dd>
                  </div>
                )}
              </dl>
            )}

            {miningResult && miningResult.gems > 0 && (
              gemTiles.length > 0 ? (
                <FindTileRow tiles={gemTiles} />
              ) : (
                <p className="text-sm text-sky-300">💎 +{miningResult.gems} Gem{miningResult.gems === 1 ? '' : 's'} found</p>
              )
            )}

            {vipSummary && <VipAutomationSummarySection summary={vipSummary} />}

            {lootHoldingCount > 0 && <LootHoldingCard />}

            <Button variant="primary" onClick={handleClose} className="w-full">
              Got it
            </Button>
          </>
        )}
      </div>
      </div>
    </div>
  )
}
