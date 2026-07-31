import { useEffect, useState } from 'react'
import ForgeCompositionPanel from './ForgeCompositionPanel'
import type { FuelEntry } from './ForgeFuelSlots'
import ForgeUpgradeSlot from './ForgeUpgradeSlot'
import { DragDropProvider } from './dragDrop'
import InventoryPanel from './InventoryPanel'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { formatItemDisplayName, formatQualityAndLevel, getItemIcon, getQualityColor, nextQualityTier } from '../game/items/equipmentBonus'
import { findNextTemplateInChain, parseStoneDragId, previewLevelUpgradeCost, previewQualityUpgradeCost } from '../game/items/forgeCosts'
import { useForgeStore } from '../game/items/useForgeStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

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
      return 'Already at Ascended quality.'
    case 'already_max_level':
      return 'Already at the top tier for this item.'
    case 'no_upgrade_path':
      return 'This item has no further upgrades.'
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

  // Routes a grid tile's drop (see dragDrop.tsx) to whichever Forge target it
  // landed on, identified by that target's data-drop-zone key — "upgrade" (see
  // ForgeUpgradeSlot) or "fuel-0"/"fuel-1" (see ForgeFuelSlots).
  const handleTileDrop = (overTarget: string, id: string) => {
    if (overTarget === 'upgrade') {
      handleDropItemId(id)
      return
    }

    if (overTarget.startsWith('fuel-')) {
      const slotIndex = Number(overTarget.slice('fuel-'.length))
      handleDropFuelSlot(slotIndex, id)
    }
  }

  const isMaxQuality = selectedItem?.quality_tier === 'super'
  const nextLevelTemplate = selectedTemplate ? findNextTemplateInChain(templates, selectedTemplate) : null
  const isMaxLevel = Boolean(selectedTemplate) && !nextLevelTemplate
  const qualityCost = selectedItem ? previewQualityUpgradeCost() : 0
  const levelCost = selectedItem ? previewLevelUpgradeCost() : 0

  const qualityDisabledReason = !selectedItem
    ? null
    : isMaxQuality
      ? 'Already at Ascended quality.'
      : dragonballs < qualityCost
        ? `Need ${qualityCost} DragonBall${qualityCost === 1 ? '' : 's'} (have ${dragonballs}).`
        : null
  const levelDisabledReason = !selectedItem
    ? null
    : isMaxLevel
      ? selectedTemplate?.item_family
        ? 'Already at the top tier for this item.'
        : 'This item has no further upgrades.'
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

    // Level Upgrade now advances the item to the next template in its family's
    // chain (see forgeCosts.findNextTemplateInChain / the level_upgrade SQL
    // function) — the preview shows that real next item's name/level, not just
    // an incremented number, since a concrete next template now exists.
    if (!nextLevelTemplate) {
      return null
    }
    return {
      name: formatItemDisplayName(nextLevelTemplate.name, selectedItem.quality_tier, selectedItem.composition_level),
      qualityAndLevel: formatQualityAndLevel(selectedItem.quality_tier, nextLevelTemplate.required_level),
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
    <DragDropProvider>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Stacks vertically below `lg` — the Result Preview's fixed 240px
            width plus the Upgrade Slot next to it (no flex-wrap) was wider
            than a phone viewport, the same overflow pattern Combat/Warehouse
            had. Unchanged side-by-side layout at `lg`+. */}
        <div className="flex flex-col items-center gap-4 lg:flex-row lg:justify-center lg:gap-6">
          <ForgeUpgradeSlot
            item={selectedItem}
            template={selectedTemplate}
            onRemove={handleRemove}
          />

          <div className="w-full space-y-3 lg:w-60 lg:shrink-0">
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
                            {getItemIcon(selectedTemplate?.slot_type)}
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

        {/* Draggable only here — opting into onTileDrop is what enables it. */}
        <InventoryPanel
          columns={5}
          reservedItemIds={[...(selectedItemId ? [selectedItemId] : []), ...fuelIds]}
          onTileDrop={handleTileDrop}
        />
      </div>
    </DragDropProvider>
  )
}
