import { useState } from 'react'
import { DragDropProvider } from './dragDrop'
import EquippedGearPicker from './EquippedGearPicker'
import ForgePreviewSlot from './ForgePreviewSlot'
import ForgeTwoColumnLayout from './ForgeTwoColumnLayout'
import ForgeUpgradeSlot from './ForgeUpgradeSlot'
import InventoryPanel from './InventoryPanel'
import { Button } from './ui/Button'
import { nextQualityTier } from '../game/items/equipmentBonus'
import {
  computeUpgradeSuccessChancePct,
  effectiveCurrencyAvailable,
  exceedsCharacterLevel,
  findNextTemplateInChain,
  levelUpgradeCurrency,
  previewMasterForgeCost,
  previewMasterForgeWeaponLevelCost,
} from '../game/items/forgeCosts'
import { useForgeStore } from '../game/items/useForgeStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'

// Promotion materials (Lunar Chest, Umbrite Ore, Jade Shard, Opaline Gem) and
// Mining Ore (Iron/Silver/Gold) have no stats and no upgrade chain — the
// backend rejects a Quality Upgrade on either slot_type. Quiver is
// deliberately NOT excluded here (unlike regular Forge's own
// isUpgradeEligibleSlotType, ForgeStandardPanel.tsx) — it just fails
// downstream with "no further upgrades" like any other maxed item. Shared by
// handleSelectItem (blocks the drop) and isTileEligible (dims the tile
// beforehand) so the two can't drift apart.
function isMasterForgeEligibleSlotType(slotType: string | undefined): boolean {
  return slotType !== 'promotion-material' && slotType !== 'material'
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
    case 'no_quality_upgrade_path':
      return "This item can't have its quality upgraded."
    case 'exceeds_character_level':
      return "This would exceed your character's own level."
    case 'not_owner':
    case 'item_not_found':
      return "Couldn't find that item."
    default:
      return 'Something went wrong.'
  }
}

// Master Forge (2026-08-05, confirmed with the user) — a guaranteed-success
// alternative to the regular RNG Quality/Level Upgrade (see ForgePanel.tsx),
// priced at 1.5x the expected manual cost (see forgeCosts.ts's
// previewMasterForgeCost, which mirrors master_forge_upgrade's own SQL
// formula for an instant client-side preview). Unlike the regular Forge
// (upgrade mode picked by *what* you drag in), the player picks Quality or
// Level FIRST via two buttons, then supplies the item either by dragging it
// in (reusing the same ForgeUpgradeSlot) or by tapping one of their own
// currently-equipped items directly — a capability regular Forge doesn't
// have, where an equipped item must be unequipped first.
//
// Level Upgrade specifically refuses a result above the character's own
// level — manual Level Upgrade deliberately has no such check (players
// sometimes level cheap Shop-bought gear purely to farm the armor
// socket-unlock roll or to resell it, never intending to equip it), but a
// guaranteed, premium result is assumed to be for actual use.
interface MasterForgePanelProps {
  onBack: () => void
}

export default function MasterForgePanel({ onBack }: MasterForgePanelProps) {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const comets = useCurrencyStore((state) => state.comets)
  const fallenStars = useCurrencyStore((state) => state.fallenStars)
  const cometScrolls = useCurrencyStore((state) => state.cometScrolls)
  const fallenStarScrolls = useCurrencyStore((state) => state.fallenStarScrolls)
  const characterLevel = useProgressionStore((state) => state.level)
  const busy = useForgeStore((state) => state.busy)
  const masterForgeUpgrade = useForgeStore((state) => state.masterForgeUpgrade)

  const [upgradeType, setUpgradeType] = useState<'quality' | 'level' | null>('quality')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const findItem = (id: string) => items.find((item) => item.id === id) ?? null
  const selectedItem = selectedItemId ? findItem(selectedItemId) : null
  const selectedTemplate = selectedItem ? (templates.find((t) => t.id === selectedItem.template_id) ?? null) : null

  const handlePickType = (type: 'quality' | 'level') => {
    setUpgradeType(type)
    setSelectedItemId(null)
    setResult(null)
  }

  const handleSelectItem = (id: string) => {
    const template = templates.find((entry) => entry.id === items.find((item) => item.id === id)?.template_id)
    if (!isMasterForgeEligibleSlotType(template?.slot_type)) {
      return
    }
    setSelectedItemId(id)
    setResult(null)
  }

  // No material-drop second phase here (Master Forge computes its cost
  // automatically once Quality/Level is picked) — eligibility is just "is
  // this a gear item Master Forge will actually accept," constant
  // regardless of whether an item is already staged.
  const isTileEligible = (dragId: string): boolean => {
    const item = items.find((entry) => entry.id === dragId)
    const template = item ? templates.find((entry) => entry.id === item.template_id) : undefined
    return Boolean(item) && isMasterForgeEligibleSlotType(template?.slot_type)
  }

  const handleRemove = () => {
    setSelectedItemId(null)
    setResult(null)
  }

  const handleTileDrop = (overTarget: string, id: string) => {
    if (overTarget === 'upgrade') {
      handleSelectItem(id)
    }
  }

  const nextLevelTemplate =
    upgradeType === 'level' && selectedTemplate ? findNextTemplateInChain(templates, selectedTemplate) : null
  const nextTier = upgradeType === 'quality' && selectedItem ? nextQualityTier(selectedItem.quality_tier) : null

  const previewItem: ItemInstance | null = (() => {
    if (!selectedItem) return null
    if (upgradeType === 'quality') return nextTier ? { ...selectedItem, quality_tier: nextTier } : null
    if (upgradeType === 'level')
      return nextLevelTemplate ? { ...selectedItem, template_id: nextLevelTemplate.id, level: nextLevelTemplate.required_level } : null
    return null
  })()
  const previewTemplate = upgradeType === 'level' ? nextLevelTemplate : selectedTemplate

  const successChancePct =
    selectedItem && selectedTemplate && upgradeType
      ? computeUpgradeSuccessChancePct(
          templates,
          selectedTemplate.item_family,
          selectedTemplate.required_level,
          selectedItem.quality_tier,
          upgradeType,
        )
      : null
  // Weapons at required_level 120+ pay their Level Upgrade in Fallen Stars
  // instead of Comets (see forgeCosts.ts's levelUpgradeCurrency) — Quality
  // Upgrade is always Fallen Star regardless, unchanged. Master Forge is the
  // *only* place a weapon can Level Upgrade past 120 (regular Forge refuses
  // outright), at a flat 1 Fallen Star per level instead of the usual
  // 1.5x-expected-cost formula — there's no more "manual" cost to price that
  // formula off of once the regular Forge path is gone.
  const masterCurrency =
    upgradeType === 'quality' ? 'fallen_star' : levelUpgradeCurrency(selectedTemplate?.slot_type, selectedTemplate?.required_level)
  const cost =
    upgradeType === 'level' && masterCurrency === 'fallen_star'
      ? previewMasterForgeWeaponLevelCost()
      : successChancePct !== null
        ? previewMasterForgeCost(successChancePct)
        : null

  const resultExceedsCharacterLevel = upgradeType === 'level' && exceedsCharacterLevel(nextLevelTemplate, characterLevel)

  const blockedReason = (() => {
    if (!selectedItem) return null
    if (upgradeType === 'quality' && !nextTier) return 'Already at Ascended quality.'
    if (upgradeType === 'level' && !nextLevelTemplate) {
      return selectedTemplate?.item_family ? 'Already at the top tier for this item.' : 'This item has no further upgrades.'
    }
    if (resultExceedsCharacterLevel && nextLevelTemplate) {
      return `This would make the item level ${nextLevelTemplate.required_level}, above your own level ${characterLevel}.`
    }
    if (cost !== null) {
      const owned = masterCurrency === 'fallen_star' ? fallenStars : comets
      const scrolls = masterCurrency === 'fallen_star' ? fallenStarScrolls : cometScrolls
      if (effectiveCurrencyAvailable(owned, scrolls) < cost) {
        const label = masterCurrency === 'fallen_star' ? 'Fallen Star' : 'Comet'
        const haveDescription = scrolls > 0 ? `have ${owned} + ${scrolls} Scroll${scrolls === 1 ? '' : 's'}` : `have ${owned}`
        return `Need ${cost} ${label}${cost === 1 ? '' : 's'} (${haveDescription}).`
      }
    }
    return null
  })()

  const canConfirm = Boolean(previewItem) && !blockedReason && cost !== null

  const handleConfirm = async () => {
    if (!selectedItem || !upgradeType) return
    const upgradeResult = await masterForgeUpgrade(selectedItem.id, upgradeType)
    if (!upgradeResult.ok) {
      setResult({ success: false, message: describeFailure(upgradeResult.error) })
      return
    }
    setResult({ success: true, message: 'Guaranteed upgrade complete!' })
    setSelectedItemId(null)
  }

  return (
    <DragDropProvider>
      <ForgeTwoColumnLayout
        title="Master Forge"
        onBack={onBack}
        inventory={
          <InventoryPanel
            columns={5}
            reservedItemIds={selectedItemId ? [selectedItemId] : []}
            onTileDrop={handleTileDrop}
            isTileEligible={isTileEligible}
            tapToPlaceEnabled
          />
        }
      >
        <p className="max-w-sm text-center text-[11px] text-slate-300">
          A Forge master will guarantee a Quality or Level Upgrade — for a price well above the usual materials.
        </p>

        <div className="flex gap-3">
          {upgradeType === 'quality' ? (
            <button type="button" className="rounded-lg border border-slate-300 bg-slate-300/10 px-4 py-2 text-sm font-medium text-slate-100">
              Quality
            </button>
          ) : (
            <div className="ascension-chip-frame is-interactive">
              <button
                type="button"
                onClick={() => handlePickType('quality')}
                className="ascension-chip-inner px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-100"
              >
                Quality
              </button>
            </div>
          )}
          {upgradeType === 'level' ? (
            <button type="button" className="rounded-lg border border-slate-300 bg-slate-300/10 px-4 py-2 text-sm font-medium text-slate-100">
              Level
            </button>
          ) : (
            <div className="ascension-chip-frame is-interactive">
              <button
                type="button"
                onClick={() => handlePickType('level')}
                className="ascension-chip-inner px-4 py-2 text-sm font-medium text-slate-300 hover:text-slate-100"
              >
                Level
              </button>
            </div>
          )}
        </div>

        {upgradeType && (
          <>
            <div className="flex items-start justify-center gap-6">
              <ForgeUpgradeSlot item={selectedItem} template={selectedTemplate} onRemove={handleRemove} />
              <ForgePreviewSlot previewItem={previewItem} previewTemplate={previewTemplate} slotId="master-forge-preview" />
            </div>

            {!selectedItem && <EquippedGearPicker onSelect={handleSelectItem} />}

            <div className="w-full max-w-xs space-y-2">
              {result && (
                <div
                  className={`rounded-xl border p-3 text-center text-sm ${
                    result.success
                      ? 'forge-success-flash border-emerald-600 bg-emerald-500/10 text-emerald-300'
                      : 'border-red-800 bg-red-500/10 text-red-300'
                  }`}
                >
                  {result.message}
                </div>
              )}

              {!selectedItem ? (
                <p className="text-center text-[11px] text-slate-300">Tap or drag an item into the Upgrade Slot, or tap one you have equipped.</p>
              ) : blockedReason ? (
                <p className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-3 text-center text-[11px] text-amber-400">
                  {blockedReason}
                </p>
              ) : (
                cost !== null && (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-center text-xs text-slate-400">
                      Guaranteed success — costs <span className="font-semibold text-slate-200">{cost}</span>{' '}
                      {masterCurrency === 'fallen_star' ? `Fallen Star${cost === 1 ? '' : 's'}` : `Comet${cost === 1 ? '' : 's'}`}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="primary" disabled={busy || !canConfirm} onClick={() => void handleConfirm()}>
                        {busy ? 'Working…' : 'Confirm Master Upgrade'}
                      </Button>
                      <Button variant="secondary" disabled={busy} onClick={handleRemove}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )
              )}
            </div>
          </>
        )}
      </ForgeTwoColumnLayout>
    </DragDropProvider>
  )
}
