import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import ForgeCompositionPanel from './ForgeCompositionPanel'
import ForgeMaterialSlot, { MAX_MATERIAL_ENTRIES, type MaterialEntry } from './ForgeMaterialSlot'
import ForgeSocketsPanel from './ForgeSocketsPanel'
import ForgeUpgradeSlot from './ForgeUpgradeSlot'
import { DragDropProvider } from './dragDrop'
import InventoryPanel from './InventoryPanel'
import InventorySlot, { SLOT_SIZE_CLASS, SLOT_WIDTH_CLASS } from './InventorySlot'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { formatItemDisplayName, formatQualityAndLevel, getItemIcon, getQualityColor, nextQualityTier } from '../game/items/equipmentBonus'
import {
  type CompositionSimulation,
  compositionPointValue,
  compositionPointsRequired,
  findNextTemplateInChain,
  formatCompositionTier,
  isDragonballDragId,
  isMeteorDragId,
  parseStoneDragId,
  previewLevelUpgradeCost,
  previewQualityUpgradeCost,
  simulateCompositionFeed,
} from '../game/items/forgeCosts'
import { useForgeStore } from '../game/items/useForgeStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

// How long a result banner (success/failure) stays up before the Upgrade Slot
// resets itself for the next item, per the spec's "return to empty" behavior.
// Composition never uses this — Feed always applies immediately (see
// ForgeCompositionPanel).
const RESULT_DISPLAY_MS = 2600

type MaterialMode = 'quality' | 'level' | 'composition'

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
      return 'Place at least one stone or item in the Material slot.'
    case 'not_owner':
    case 'item_not_found':
      return "Couldn't find that item."
    default:
      return 'Something went wrong.'
  }
}

type ResolvedMaterialKind =
  | { kind: 'stone'; tier: number }
  | { kind: 'currency'; currencyType: 'meteor' | 'dragonball' }
  | { kind: 'item' }
  | null

// What a dragged tile means once it lands in the Material slot — a stone or
// gear item is Composition fuel; a Meteor/DragonBall tile isn't literally
// consumed by being dropped (the RPCs still just deduct a flat 1 from the
// character's own count), it's purely how the player tells the Forge which
// action they mean, since Quality/Level Upgrade take no fuel item at all.
function resolveMaterialKind(id: string, items: ItemInstance[]): ResolvedMaterialKind {
  const stoneTier = parseStoneDragId(id)
  if (stoneTier !== null) {
    return { kind: 'stone', tier: stoneTier }
  }
  if (isMeteorDragId(id)) {
    return { kind: 'currency', currencyType: 'meteor' }
  }
  if (isDragonballDragId(id)) {
    return { kind: 'currency', currencyType: 'dragonball' }
  }
  if (items.some((item) => item.id === id)) {
    return { kind: 'item' }
  }
  return null
}

// The load bar spanning the Upgrade+Material columns (per the user's request)
// — a dim bar shows the item's current composition progress, a brighter bar
// stretches out to whatever the staged Material would produce if fed. Shown
// only while materialMode === 'composition' (see ForgePanel).
function CompositionLoadBar({
  item,
  addedPoints,
  preview,
}: {
  item: ItemInstance
  addedPoints: number
  preview: CompositionSimulation | null
}) {
  const required = compositionPointsRequired(item.composition_level)
  const currentPercent = required > 0 ? Math.min(100, (item.composition_points / required) * 100) : 100
  const afterPercent = preview ? (preview.required > 0 ? Math.min(100, (preview.points / preview.required) * 100) : 100) : currentPercent
  const tiersGained = preview ? preview.level - item.composition_level : 0

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>
          {formatCompositionTier(item.composition_level)} composition
          {tiersGained > 0 ? ` — +${tiersGained} tier${tiersGained === 1 ? '' : 's'} pending!` : ''}
        </span>
        {addedPoints > 0 && <span>+{addedPoints} pts staged</span>}
      </div>
      <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div className="absolute inset-y-0 left-0 rounded-full bg-sky-500/40" style={{ width: `${currentPercent}%` }} />
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-sky-400"
          initial={false}
          animate={{ width: `${afterPercent}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
    </div>
  )
}

interface PreviewData {
  name: string
  qualityAndLevel: string
  color: string
}

// The third square in the Upgrade/Material/Preview row — same fixed tile size
// as the other two (see SLOT_SIZE_CLASS), just showing a glimpse of the
// result rather than being draggable. The actual name/cost/Confirm button
// live in the details area below the row (see ForgePanel), so this stays a
// plain icon tile, matching Upgrade/Material's own square footprint.
function PreviewSquare({
  selectedItem,
  selectedTemplate,
  materialMode,
  previewData,
}: {
  selectedItem: ItemInstance | null
  selectedTemplate: { slot_type: string } | null
  materialMode: MaterialMode | null
  previewData: PreviewData | null
}) {
  const filled = Boolean(selectedItem && materialMode && (materialMode === 'composition' || previewData))

  return (
    <div className={`flex flex-col items-center gap-2 ${SLOT_WIDTH_CLASS}`}>
      <p className="text-center text-[10px] uppercase leading-tight tracking-wide text-slate-500">Preview</p>

      <div className={SLOT_SIZE_CLASS}>
        {filled && selectedItem ? (
          <InventorySlot
            slotId="forge-preview"
            filled
            sizeClassName={SLOT_SIZE_CLASS}
            icon={getItemIcon(selectedTemplate?.slot_type)}
            qualityColor={materialMode === 'composition' ? getQualityColor(selectedItem.quality_tier) : previewData?.color}
            label={materialMode === 'composition' ? 'Composition preview' : previewData?.name}
          />
        ) : (
          <InventorySlot slotId="forge-preview-empty" filled={false} sizeClassName={SLOT_SIZE_CLASS} />
        )}
      </div>
    </div>
  )
}

// Forge screen: three slots side by side at every viewport size — Upgrade
// (left), Material (middle), Preview (right) — with the Inventory grid below/
// beside it feeding items into them. Dropping something into the Material
// slot both stages it and picks the upgrade path dynamically (Meteor -> Level,
// DragonBall -> Quality, Stone/gear -> Composition) — there's no separate
// Quality/Level/Composition button row anymore, per the user's request
// (2026-08-02) that "these should all be dragged." Weapon Socket unlock is
// deliberately NOT part of this material-driven flow (it shares DragonBalls
// with Quality Upgrade with no way to tell them apart from what's dropped) —
// it stays its own small toggle, unchanged internally (ForgeSocketsPanel).
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
  const [materialEntries, setMaterialEntries] = useState<MaterialEntry[]>([])
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [socketsOpen, setSocketsOpen] = useState(false)

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null
  const selectedTemplate = selectedItem ? (templates.find((t) => t.id === selectedItem.template_id) ?? null) : null

  // Whichever kind of thing occupies the first Material entry decides the
  // mode — a currency entry always collapses to a single entry (see
  // handleDropMaterial), so there's never a mix of e.g. a Meteor and a Stone
  // staged at once.
  const materialMode: MaterialMode | null =
    materialEntries.length === 0
      ? null
      : materialEntries[0].kind === 'currency'
        ? materialEntries[0].currencyType === 'meteor'
          ? 'level'
          : 'quality'
        : 'composition'

  const stoneAmounts = materialEntries.reduce<Record<string, number>>((amounts, entry) => {
    if (entry.kind === 'stone') {
      amounts[String(entry.tier)] = (amounts[String(entry.tier)] ?? 0) + 1
    }
    return amounts
  }, {})
  const fuelItemIds = materialEntries.flatMap((entry) => (entry.kind === 'item' ? [entry.id] : []))

  const compositionAddedPoints = materialEntries.reduce((sum, entry) => {
    if (entry.kind === 'stone') {
      return sum + compositionPointValue(entry.tier)
    }
    if (entry.kind === 'item') {
      return sum + compositionPointValue(entry.item.composition_level)
    }
    return sum
  }, 0)
  const compositionPreview =
    selectedItem && compositionAddedPoints > 0
      ? simulateCompositionFeed(selectedItem.composition_level, selectedItem.composition_points, compositionAddedPoints)
      : null

  // Auto-dismiss the result banner. Only a SUCCESS returns the Upgrade Slot to
  // empty afterward (matching the original "ready for the next item" spec) —
  // a FAILURE leaves the item (and staged Material) in place, since materials
  // were already spent either way and a fresh attempt on the same item is the
  // overwhelmingly common next action.
  useEffect(() => {
    if (!attemptResult) {
      return undefined
    }

    const timeout = setTimeout(() => {
      setAttemptResult(null)
      if (attemptResult.success) {
        setSelectedItemId(null)
        setMaterialEntries([])
        setSocketsOpen(false)
      }
    }, RESULT_DISPLAY_MS)

    return () => clearTimeout(timeout)
  }, [attemptResult])

  const handleDropItemId = (itemId: string) => {
    if (!items.some((item) => item.id === itemId) || materialEntries.some((entry) => entry.id === itemId)) {
      return
    }

    setSelectedItemId(itemId)
    setAttemptResult(null)
    setMaterialEntries([])
    setFeedError(null)
    setSocketsOpen(false)
  }

  const handleRemove = () => {
    setSelectedItemId(null)
    setAttemptResult(null)
    setMaterialEntries([])
    setFeedError(null)
    setSocketsOpen(false)
  }

  const handleDropMaterial = (id: string) => {
    // Nothing to preview a Material drop against without a target item.
    if (!selectedItem || id === selectedItemId || materialEntries.some((entry) => entry.id === id)) {
      return
    }

    const resolved = resolveMaterialKind(id, items)
    if (!resolved) {
      return
    }

    if (resolved.kind === 'currency') {
      // A currency tile always collapses to a single entry — Quality/Level
      // are flat-cost-1, there's nothing gained by stacking more.
      setMaterialEntries([{ kind: 'currency', id, currencyType: resolved.currencyType }])
      setFeedError(null)
      return
    }

    if (resolved.kind === 'stone') {
      setMaterialEntries((current) => {
        const base = current[0]?.kind === 'currency' ? [] : current
        return base.length >= MAX_MATERIAL_ENTRIES ? base : [...base, { kind: 'stone', id, tier: resolved.tier }]
      })
      setFeedError(null)
      return
    }

    const item = items.find((entry) => entry.id === id)
    if (!item) {
      return
    }

    setMaterialEntries((current) => {
      const base = current[0]?.kind === 'currency' ? [] : current
      return base.length >= MAX_MATERIAL_ENTRIES ? base : [...base, { kind: 'item', id, item }]
    })
    setFeedError(null)
  }

  const handleRemoveMaterial = (id: string) => {
    setMaterialEntries((current) => current.filter((entry) => entry.id !== id))
    setFeedError(null)
  }

  // Routes a grid tile's drop (see dragDrop.tsx) to whichever Forge target it
  // landed on, identified by that target's data-drop-zone key — "upgrade"
  // (see ForgeUpgradeSlot) or "material" (see ForgeMaterialSlot).
  const handleTileDrop = (overTarget: string, id: string) => {
    if (overTarget === 'upgrade') {
      handleDropItemId(id)
      return
    }

    if (overTarget === 'material') {
      handleDropMaterial(id)
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
    if (!selectedItem || !selectedTemplate || (materialMode !== 'quality' && materialMode !== 'level')) {
      return null
    }

    if (materialMode === 'quality') {
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
    if (!selectedItem || (materialMode !== 'quality' && materialMode !== 'level')) {
      return
    }

    const result = materialMode === 'quality' ? await qualityUpgrade(selectedItem.id) : await levelUpgrade(selectedItem.id)

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
    setMaterialEntries([])
    setFeedError(null)
  }

  const showCompositionBar = materialMode === 'composition' && Boolean(selectedItem)

  return (
    <DragDropProvider>
      {/* Single centered column at every viewport size — the row of three
          equal squares (Upgrade/Material/Preview) is centered as a group via
          justify-center, which naturally puts the middle (Material) square
          at the center of the row; the Inventory grid below is centered the
          same way (see InventoryPanel's own drop-zone wrapper). */}
      <div className="flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-start justify-center gap-3">
            {/* Upgrade + Material paired so the composition load bar (below)
                can stretch to exactly their combined width, per the "load bar
                stretching underneath the upgrade and material slots" ask. */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-3">
                <ForgeUpgradeSlot item={selectedItem} template={selectedTemplate} onRemove={handleRemove} />
                <ForgeMaterialSlot entries={materialEntries} templates={templates} onRemoveEntry={handleRemoveMaterial} />
              </div>

              {showCompositionBar && selectedItem && (
                <CompositionLoadBar item={selectedItem} addedPoints={compositionAddedPoints} preview={compositionPreview} />
              )}
            </div>

            <PreviewSquare
              selectedItem={selectedItem}
              selectedTemplate={selectedTemplate}
              materialMode={materialMode}
              previewData={previewData}
            />
          </div>

          <div className="w-full max-w-xs space-y-2">
            {!selectedItem ? (
              <p className="text-center text-[11px] text-slate-600">Drag an item into the Upgrade Slot.</p>
            ) : !materialMode ? (
              <p className="text-center text-[11px] text-slate-600">
                Drag a Meteor, DragonBall, Stone, or gear item into the Material slot.
              </p>
            ) : materialMode === 'composition' ? (
              <ForgeCompositionPanel
                item={selectedItem}
                entries={materialEntries}
                busy={busy}
                onFeed={() => void handleFeed()}
                feedError={feedError}
              />
            ) : (
              <>
                {attemptResult && (
                  <div
                    className={`rounded-xl border p-3 text-center text-sm ${
                      attemptResult.success
                        ? 'forge-success-flash border-emerald-600 bg-emerald-500/10 text-emerald-300'
                        : 'border-red-800 bg-red-500/10 text-red-300'
                    }`}
                  >
                    {attemptResult.message}
                  </div>
                )}

                {previewData ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-center">
                    <p className="text-[10px] uppercase tracking-wide text-slate-600">After upgrade</p>
                    <p className="mt-1 text-xs font-medium text-slate-200">{previewData.name}</p>
                    <p className="text-[10px] text-slate-500">{previewData.qualityAndLevel}</p>

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
                  <p className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-3 text-center text-[11px] text-slate-600">
                    {materialMode === 'quality' ? qualityDisabledReason : levelDisabledReason}
                  </p>
                )}
              </>
            )}
          </div>

          {selectedItem && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setSocketsOpen((open) => !open)}
                className="text-[10px] text-slate-500 underline hover:text-slate-300"
              >
                {socketsOpen ? 'Hide Sockets' : 'Sockets'}
              </button>

              {socketsOpen && (
                <div className="mt-2 w-full max-w-xs rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-left">
                  <ForgeSocketsPanel item={selectedItem} template={selectedTemplate} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Draggable only here — opting into onTileDrop is what enables it. */}
        <InventoryPanel
          columns={5}
          reservedItemIds={[...(selectedItemId ? [selectedItemId] : []), ...materialEntries.map((entry) => entry.id)]}
          onTileDrop={handleTileDrop}
        />
      </div>
    </DragDropProvider>
  )
}
