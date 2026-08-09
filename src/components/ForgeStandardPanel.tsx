import { useEffect, useState } from 'react'
import ForgeMaterialSlot, { type MaterialEntry } from './ForgeMaterialSlot'
import ForgePreviewSlot from './ForgePreviewSlot'
import ForgeTwoColumnLayout from './ForgeTwoColumnLayout'
import ForgeUpgradeSlot from './ForgeUpgradeSlot'
import { DragDropProvider } from './dragDrop'
import InventoryPanel from './InventoryPanel'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { nextQualityTier } from '../game/items/equipmentBonus'
import {
  effectiveCurrencyAvailable,
  findNextTemplateInChain,
  isFallenStarDragId,
  isCometDragId,
  previewLevelUpgradeCost,
  previewQualityUpgradeCost,
} from '../game/items/forgeCosts'
import { useForgeStore } from '../game/items/useForgeStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

const RESULT_DISPLAY_MS = 2600

type MaterialMode = 'quality' | 'level'

interface AttemptResult {
  success: boolean
  message: string
}

function describeFailure(error?: string): string {
  switch (error) {
    case 'not_enough_fallen_stars':
      return 'Not enough Fallen Stars.'
    case 'not_enough_comets':
      return 'Not enough Comets.'
    case 'not_enough_room_to_unbundle':
      return "Would need to unbundle a Scroll for this, but there's no Inventory room for it."
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

interface ForgeStandardPanelProps {
  onBack: () => void
}

// Forge (2026-08-13 redesign — Quality/Level only now; Composition moved out
// to its own tile/panel, see ForgeCompositionTab.tsx). Drop a Comet or Fallen
// Star into the Material slot to pick the upgrade path, same drag-driven
// convention as before, just narrower — a stone or gear item dropped here no
// longer does anything (that's Composition's own drop target now).
export default function ForgeStandardPanel({ onBack }: ForgeStandardPanelProps) {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const comets = useCurrencyStore((state) => state.comets)
  const fallenStars = useCurrencyStore((state) => state.fallenStars)
  const cometScrolls = useCurrencyStore((state) => state.cometScrolls)
  const fallenStarScrolls = useCurrencyStore((state) => state.fallenStarScrolls)
  const busy = useForgeStore((state) => state.busy)
  const qualityUpgrade = useForgeStore((state) => state.qualityUpgrade)
  const levelUpgrade = useForgeStore((state) => state.levelUpgrade)

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [materialEntries, setMaterialEntries] = useState<MaterialEntry[]>([])
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null)

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null
  const selectedTemplate = selectedItem ? (templates.find((t) => t.id === selectedItem.template_id) ?? null) : null

  const materialMode: MaterialMode | null =
    materialEntries.length === 0 || materialEntries[0].kind !== 'currency'
      ? null
      : materialEntries[0].currencyType === 'comet'
        ? 'level'
        : 'quality'

  useEffect(() => {
    if (!attemptResult) {
      return undefined
    }

    const timeout = setTimeout(() => {
      setAttemptResult(null)
      if (attemptResult.success) {
        setSelectedItemId(null)
        setMaterialEntries([])
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
  }

  const handleRemove = () => {
    setSelectedItemId(null)
    setAttemptResult(null)
    setMaterialEntries([])
  }

  const handleDropMaterial = (id: string) => {
    if (!selectedItem || id === selectedItemId) {
      return
    }

    if (isCometDragId(id)) {
      setMaterialEntries([{ kind: 'currency', id, currencyType: 'comet' }])
      return
    }

    if (isFallenStarDragId(id)) {
      setMaterialEntries([{ kind: 'currency', id, currencyType: 'fallen_star' }])
    }
  }

  const handleRemoveMaterial = (id: string) => {
    setMaterialEntries((current) => current.filter((entry) => entry.id !== id))
  }

  const handleTileDrop = (overTarget: string, id: string) => {
    if (overTarget === 'upgrade') {
      handleDropItemId(id)
      return
    }

    if (overTarget === 'material') {
      handleDropMaterial(id)
    }
  }

  const isMaxQuality = selectedItem?.quality_tier === 'ascended'
  const nextLevelTemplate = selectedTemplate ? findNextTemplateInChain(templates, selectedTemplate) : null
  const isMaxLevel = Boolean(selectedTemplate) && !nextLevelTemplate
  const qualityCost = selectedItem ? previewQualityUpgradeCost() : 0
  const levelCost = selectedItem ? previewLevelUpgradeCost() : 0

  const qualityDisabledReason = !selectedItem
    ? null
    : isMaxQuality
      ? 'Already at Ascended quality.'
      : effectiveCurrencyAvailable(fallenStars, fallenStarScrolls) < qualityCost
        ? `Need ${qualityCost} Fallen Star${qualityCost === 1 ? '' : 's'} (${
            fallenStarScrolls > 0 ? `have ${fallenStars} + ${fallenStarScrolls} Scroll${fallenStarScrolls === 1 ? '' : 's'}` : `have ${fallenStars}`
          }).`
        : null
  const levelDisabledReason = !selectedItem
    ? null
    : isMaxLevel
      ? selectedTemplate?.item_family
        ? 'Already at the top tier for this item.'
        : 'This item has no further upgrades.'
      : effectiveCurrencyAvailable(comets, cometScrolls) < levelCost
        ? `Need ${levelCost} Comet${levelCost === 1 ? '' : 's'} (${
            cometScrolls > 0 ? `have ${comets} + ${cometScrolls} Scroll${cometScrolls === 1 ? '' : 's'}` : `have ${comets}`
          }).`
        : null

  const previewItem: ItemInstance | null = (() => {
    if (!selectedItem) {
      return null
    }

    if (materialMode === 'quality') {
      const next = nextQualityTier(selectedItem.quality_tier)
      return next ? { ...selectedItem, quality_tier: next } : null
    }

    if (materialMode === 'level') {
      return nextLevelTemplate ? { ...selectedItem, template_id: nextLevelTemplate.id, level: nextLevelTemplate.required_level } : null
    }

    return null
  })()

  const previewTemplate = materialMode === 'level' ? nextLevelTemplate : selectedTemplate

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

  return (
    <DragDropProvider>
      <ForgeTwoColumnLayout
        title="Forge"
        onBack={onBack}
        inventory={
          <InventoryPanel
            columns={5}
            reservedItemIds={[...(selectedItemId ? [selectedItemId] : []), ...materialEntries.map((entry) => entry.id)]}
            onTileDrop={handleTileDrop}
          />
        }
      >
        <div className="flex items-start justify-center gap-6">
          <ForgeUpgradeSlot item={selectedItem} template={selectedTemplate} onRemove={handleRemove} />
          <ForgeMaterialSlot entries={materialEntries} templates={templates} onRemoveEntry={handleRemoveMaterial} />
          <ForgePreviewSlot previewItem={previewItem} previewTemplate={previewTemplate} slotId="forge-standard-preview" />
        </div>

        <div className="w-full max-w-xs space-y-2">
          {!selectedItem ? (
            <p className="text-center text-[11px] text-slate-600">Drag an item into the Upgrade Slot.</p>
          ) : !materialMode ? (
            <p className="text-center text-[11px] text-slate-600">Drag a Comet or Fallen Star into the Material slot.</p>
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

              {previewItem ? (
                <div className="flex justify-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleConfirm()}
                    className="rounded-lg border border-emerald-600 bg-emerald-500/10 px-4 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? 'Working…' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setMaterialEntries([])}
                    className="rounded-lg border border-slate-700 px-4 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
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
      </ForgeTwoColumnLayout>
    </DragDropProvider>
  )
}
