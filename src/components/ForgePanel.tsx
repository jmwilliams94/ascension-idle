import { useEffect, useState } from 'react'
import ForgeCompositionPanel from './ForgeCompositionPanel'
import type { FuelEntry } from './ForgeFuelSlots'
import ForgeUpgradeSlot from './ForgeUpgradeSlot'
import InventoryPanel from './InventoryPanel'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { formatItemDisplayName, formatQualityAndLevel, getQualityColor, nextQualityTier } from '../game/items/equipmentBonus'
import { parseStoneDragId, previewLevelUpgradeCost, previewQualityUpgradeCost } from '../game/items/forgeCosts'
import { useForgeStore } from '../game/items/useForgeStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

// Mirrors the migration's v_level_cap placeholder — only used here to show "Max" on
// the button instead of a cost; the real cap enforcement lives server-side.
const ITEM_LEVEL_CAP = 130

// How long a result banner (success/failure) stays up before the Upgrade Slot
// resets itself for the next item, per the spec's "return to empty" behavior.
// Composition never uses this — see the Composition branch below.
const RESULT_DISPLAY_MS = 2600

// Confirmed: Composition feeds are capped at exactly two fuel inputs at a time —
// see ForgeFuelSlots.
const FUEL_SLOT_COUNT = 2

type UpgradeType = 'quality' | 'level' | 'composition'

interface AttemptResult {
  success: boolean
  message: string
}

function describeFailure(error?: string): string {
  switch (error) {
    case 'not_enough_dragonballs':
      return 'Not enough DragonBalls.'
    case 'not_enough_meteors':
      return 'Not enough Meteors.'
    case 'already_max_quality':
      return 'Already at Super quality.'
    case 'already_max_level':
      return 'Already at the level cap.'
    case 'not_owner':
    case 'item_not_found':
      return "Couldn't find that item."
    default:
      return 'Something went wrong.'
  }
}

function describeFeedFailure(error?: string): string {
  switch (error) {
    case 'not_enough_stones':
      return "You don't have that many of one of those stones."
    case 'fuel_not_owned':
      return "One of those fuel items couldn't be found."
    case 'fuel_is_target_item':
      return "An item can't be fed into itself."
    case 'no_points_contributed':
      return 'Place at least one stone or item in a Fuel slot.'
    case 'not_owner':
    case 'item_not_found':
      return "Couldn't find that item."
    default:
      return 'Something went wrong.'
  }
}

// Forge overlay: the Upgrade Slot + Result Preview sit on top, with the Inventory
// grid (reused, drag-and-drop enabled) below feeding items into them — native
// HTML5 drag-and-drop throughout. The Result Preview computes what the item would
// look like after the chosen upgrade path using the exact same logic the real
// Postgres functions use — no success rate is ever shown for Quality/Level (only
// the eventual outcome), and Composition has no RNG at all (see
// ForgeCompositionPanel).
export default function ForgePanel() {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const meteors = useCurrencyStore((state) => state.meteors)
  const dragonballs = useCurrencyStore((state) => state.dragonballs)
  const busy = useForgeStore((state) => state.busy)
  const qualityUpgrade = useForgeStore((state) => state.qualityUpgrade)
  const levelUpgrade = useForgeStore((state) => state.levelUpgrade)
  const compositionFeed = useForgeStore((state) => state.compositionFeed)

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<UpgradeType | null>(null)
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null)

  // Fixed-length (FUEL_SLOT_COUNT): each entry is either null (empty) or a
  // heterogeneous drag id — a real item's own id, or a synthetic
  // stoneDragId("stone:N:index") for a single stone — see forgeCosts.ts.
  const [fuelSlotIds, setFuelSlotIds] = useState<(string | null)[]>(Array<string | null>(FUEL_SLOT_COUNT).fill(null))
  const [feedError, setFeedError] = useState<string | null>(null)

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null
  const selectedTemplate = selectedItem ? (templates.find((t) => t.id === selectedItem.template_id) ?? null) : null

  const fuelSlots: (FuelEntry | null)[] = fuelSlotIds.map((id): FuelEntry | null => {
    if (!id) {
      return null
    }

    const tier = parseStoneDragId(id)
    if (tier !== null) {
      return { kind: 'stone', id, tier }
    }

    const item = items.find((entry) => entry.id === id)
    return item ? { kind: 'item', id, item } : null
  })

  const stoneAmounts = fuelSlots.reduce<Record<string, number>>((amounts, entry) => {
    if (entry?.kind === 'stone') {
      amounts[String(entry.tier)] = (amounts[String(entry.tier)] ?? 0) + 1
    }
    return amounts
  }, {})
  const fuelItemIds = fuelSlots.flatMap((entry) => (entry?.kind === 'item' ? [entry.id] : []))
  const fuelIds = fuelSlotIds.filter((id): id is string => id !== null)

  // Auto-return to the empty Upgrade Slot after showing the result, per spec —
  // Quality/Level only; Composition never sets attemptResult.
  useEffect(() => {
    if (!attemptResult) {
      return undefined
    }

    const timeout = setTimeout(() => {
      setAttemptResult(null)
      setSelectedItemId(null)
      setSelectedType(null)
    }, RESULT_DISPLAY_MS)

    return () => clearTimeout(timeout)
  }, [attemptResult])

  const resetFeedState = () => {
    setFuelSlotIds(Array<string | null>(FUEL_SLOT_COUNT).fill(null))
    setFeedError(null)
  }

  const handleDropItemId = (itemId: string) => {
    if (!items.some((item) => item.id === itemId) || fuelIds.includes(itemId)) {
      return
    }

    setSelectedItemId(itemId)
    setSelectedType(null)
    setAttemptResult(null)
    resetFeedState()
  }

  const handleRemove = () => {
    setSelectedItemId(null)
    setSelectedType(null)
    setAttemptResult(null)
    resetFeedState()
  }

  const handleSelectType = (type: UpgradeType) => {
    setSelectedType(type)
    resetFeedState()
  }

  const handleDropFuelSlot = (slotIndex: number, id: string) => {
    if (id === selectedItemId || fuelIds.includes(id)) {
      return
    }

    // A stone tile is always valid to drop (its tier just needs to exist); a gear
    // tile must be a real, currently-owned item.
    if (parseStoneDragId(id) === null && !items.some((item) => item.id === id)) {
      return
    }

    setFuelSlotIds((current) => current.map((existing, index) => (index === slotIndex ? id : existing)))
    setFeedError(null)
  }

  const handleRemoveFuelSlot = (slotIndex: number) => {
    setFuelSlotIds((current) => current.map((existing, index) => (index === slotIndex ? null : existing)))
    setFeedError(null)
  }

  const isMaxQuality = selectedItem?.quality_tier === 'super'
  const isMaxLevel = (selectedItem?.level ?? 0) >= ITEM_LEVEL_CAP
  const qualityCost = selectedItem ? previewQualityUpgradeCost(selectedItem.quality_tier) : 0
  const levelCost = selectedItem ? previewLevelUpgradeCost(selectedItem.level) : 0

  const qualityDisabledReason = !selectedItem
    ? null
    : isMaxQuality
      ? 'Already at Super quality.'
      : dragonballs < qualityCost
        ? `Need ${qualityCost} DragonBall${qualityCost === 1 ? '' : 's'} (have ${dragonballs}).`
        : null
  const levelDisabledReason = !selectedItem
    ? null
    : isMaxLevel
      ? 'Already at the level cap.'
      : meteors < levelCost
        ? `Need ${levelCost} Meteor${levelCost === 1 ? '' : 's'} (have ${meteors}).`
        : null

  const previewData = (() => {
    if (!selectedItem || !selectedTemplate || (selectedType !== 'quality' && selectedType !== 'level')) {
      return null
    }

    if (selectedType === 'quality') {
      const next = nextQualityTier(selectedItem.quality_tier)
      if (!next) {
        return null
      }
      return {
        name: formatItemDisplayName(selectedTemplate.name, next, selectedItem.composition_level),
        qualityAndLevel: formatQualityAndLevel(next, selectedItem.level),
        color: getQualityColor(next),
      }
    }

    // Level currently only advances the level number — there's no per-level stat
    // formula yet (see CLAUDE.md's Gear system section), so the preview honestly
    // shows the same stats with just the level incremented, not invented numbers.
    return {
      name: formatItemDisplayName(selectedTemplate.name, selectedItem.quality_tier, selectedItem.composition_level),
      qualityAndLevel: formatQualityAndLevel(selectedItem.quality_tier, selectedItem.level + 1),
      color: getQualityColor(selectedItem.quality_tier),
    }
  })()

  const handleConfirm = async () => {
    if (!selectedItem || (selectedType !== 'quality' && selectedType !== 'level')) {
      return
    }

    const result = selectedType === 'quality' ? await qualityUpgrade(selectedItem.id) : await levelUpgrade(selectedItem.id)

    if (!result.ok) {
      setAttemptResult({ success: false, message: describeFailure(result.error) })
      return
    }

    setAttemptResult({
      success: Boolean(result.upgraded),
      message: result.upgraded ? 'Upgrade succeeded!' : 'Upgrade failed — materials were still spent.',
    })
  }

  const handleFeed = async () => {
    if (!selectedItem) {
      return
    }

    const result = await compositionFeed(selectedItem.id, stoneAmounts, fuelItemIds)

    if (!result.ok) {
      setFeedError(describeFeedFailure(result.error))
      return
    }

    // Feeding always works — no result banner needed, just clear this round's
    // picks so the (now-updated) progress bar is ready for the next feed.
    setFuelSlotIds(Array<string | null>(FUEL_SLOT_COUNT).fill(null))
    setFeedError(null)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex justify-center gap-6">
        <ForgeUpgradeSlot
          item={selectedItem}
          template={selectedTemplate}
          onDropItemId={handleDropItemId}
          onRemove={handleRemove}
        />

        <div className="w-60 shrink-0 space-y-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Result Preview</p>

          {attemptResult ? (
            <div
              className={`rounded-xl border p-3 text-center text-sm ${
                attemptResult.success
                  ? 'forge-success-flash border-emerald-600 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-800 bg-red-500/10 text-red-300'
              }`}
            >
              {attemptResult.message}
            </div>
          ) : !selectedItem ? (
            <p className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-4 text-center text-[11px] text-slate-600">
              Drag an item into the Upgrade Slot to preview an upgrade.
            </p>
          ) : (
            <>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy || Boolean(qualityDisabledReason)}
                  onClick={() => handleSelectType('quality')}
                  title={qualityDisabledReason ?? undefined}
                  className={`flex-1 rounded-lg border px-1.5 py-2 text-[10px] font-medium leading-tight disabled:cursor-not-allowed disabled:opacity-50 ${
                    selectedType === 'quality'
                      ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  Quality
                  <br />
                  {isMaxQuality ? '(Max)' : `(${qualityCost} DB)`}
                </button>

                <button
                  type="button"
                  disabled={busy || Boolean(levelDisabledReason)}
                  onClick={() => handleSelectType('level')}
                  title={levelDisabledReason ?? undefined}
                  className={`flex-1 rounded-lg border px-1.5 py-2 text-[10px] font-medium leading-tight disabled:cursor-not-allowed disabled:opacity-50 ${
                    selectedType === 'level'
                      ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  Level
                  <br />
                  {isMaxLevel ? '(Max)' : `(${levelCost} Met)`}
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleSelectType('composition')}
                  className={`flex-1 rounded-lg border px-1.5 py-2 text-[10px] font-medium leading-tight disabled:cursor-not-allowed disabled:opacity-50 ${
                    selectedType === 'composition'
                      ? 'border-purple-500 bg-purple-500/10 text-purple-300'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  Composition
                </button>
              </div>

              {selectedType === 'composition' ? (
                <ForgeCompositionPanel
                  item={selectedItem}
                  fuelSlots={fuelSlots}
                  templates={templates}
                  onDropFuelSlot={handleDropFuelSlot}
                  onRemoveFuelSlot={handleRemoveFuelSlot}
                  busy={busy}
                  onFeed={() => void handleFeed()}
                  feedError={feedError}
                />
              ) : (
                <>
                  {selectedType && (qualityDisabledReason || levelDisabledReason) && (
                    <p className="text-center text-[10px] text-slate-500">
                      {selectedType === 'quality' ? qualityDisabledReason : levelDisabledReason}
                    </p>
                  )}

                  {previewData ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-slate-600">After upgrade</p>
                      <div className="mt-1 flex items-center gap-2">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-base"
                          style={{ borderColor: previewData.color }}
                        >
                          🗡️
                        </div>
                        <div>
                          <p className="text-xs font-medium text-slate-200">{previewData.name}</p>
                          <p className="text-[10px] text-slate-500">{previewData.qualityAndLevel}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleConfirm()}
                        className="mt-3 w-full rounded-lg border border-emerald-600 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy ? 'Working…' : 'Confirm Upgrade'}
                      </button>
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-4 text-center text-[11px] text-slate-600">
                      Choose an upgrade type to preview the result.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Draggable only here — opting into onItemDragStart/onStoneDragStart is what enables it. */}
      <InventoryPanel
        columns={5}
        reservedItemIds={[...(selectedItemId ? [selectedItemId] : []), ...fuelIds]}
        onItemDragStart={() => undefined}
        onStoneDragStart={() => undefined}
      />
    </div>
  )
}
