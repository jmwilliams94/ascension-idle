import { useState } from 'react'
import { DragDropProvider } from './dragDrop'
import ForgeUpgradeSlot from './ForgeUpgradeSlot'
import InventoryPanel from './InventoryPanel'
import InventorySlot, { SLOT_LABEL_HEIGHT_CLASS, SLOT_SIZE_CLASS, SLOT_WIDTH_CLASS } from './InventorySlot'
import {
  buildGearTooltip,
  formatItemDisplayName,
  getGearIconSrc,
  getItemIcon,
  getQualityColor,
  nextQualityTier,
} from '../game/items/equipmentBonus'
import { computeUpgradeSuccessChancePct, findNextTemplateInChain, previewMasterForgeCost } from '../game/items/forgeCosts'
import { useForgeStore } from '../game/items/useForgeStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { EQUIP_SLOTS, useEquipmentStore, type EquipSlot } from '../game/items/useEquipmentStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'

const EQUIP_SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: 'Main Hand',
  ring: 'Ring',
  necklace: 'Necklace',
  boots: 'Boots',
  hat: 'Head',
  coat: 'Armor',
  quiver: 'Quiver',
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
export default function MasterForgePanel() {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const equippedIds = useEquipmentStore((state) => state.equippedIds)
  const comets = useCurrencyStore((state) => state.comets)
  const fallenStars = useCurrencyStore((state) => state.fallenStars)
  const characterLevel = useProgressionStore((state) => state.level)
  const busy = useForgeStore((state) => state.busy)
  const masterForgeUpgrade = useForgeStore((state) => state.masterForgeUpgrade)

  const [upgradeType, setUpgradeType] = useState<'quality' | 'level' | null>(null)
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
    setSelectedItemId(id)
    setResult(null)
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
  const cost = successChancePct !== null ? previewMasterForgeCost(successChancePct) : null

  const exceedsCharacterLevel =
    upgradeType === 'level' && nextLevelTemplate ? nextLevelTemplate.required_level > characterLevel : false

  const blockedReason = (() => {
    if (!selectedItem) return null
    if (upgradeType === 'quality' && !nextTier) return 'Already at Ascended quality.'
    if (upgradeType === 'level' && !nextLevelTemplate) {
      return selectedTemplate?.item_family ? 'Already at the top tier for this item.' : 'This item has no further upgrades.'
    }
    if (exceedsCharacterLevel && nextLevelTemplate) {
      return `This would make the item level ${nextLevelTemplate.required_level}, above your own level ${characterLevel}.`
    }
    if (cost !== null) {
      const owned = upgradeType === 'quality' ? fallenStars : comets
      if (owned < cost) {
        return `Need ${cost} ${upgradeType === 'quality' ? 'Fallen Star' : 'Comet'}${cost === 1 ? '' : 's'} (have ${owned}).`
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

  const equippedEntries = EQUIP_SLOTS.map((slot) => ({ slot, itemId: equippedIds[slot] })).filter(
    (entry): entry is { slot: EquipSlot; itemId: string } => Boolean(entry.itemId),
  )

  return (
    <div className="flex flex-col items-center gap-6">
      <p className="max-w-sm text-center text-[11px] text-slate-500">
        A Forge master will guarantee a Quality or Level Upgrade — for a price well above the usual materials.
      </p>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => handlePickType('quality')}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${
            upgradeType === 'quality' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Quality
        </button>
        <button
          type="button"
          onClick={() => handlePickType('level')}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${
            upgradeType === 'level' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Level
        </button>
      </div>

      {upgradeType && (
        <DragDropProvider>
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-start justify-center gap-6">
              <ForgeUpgradeSlot item={selectedItem} template={selectedTemplate} onRemove={handleRemove} />

              <div className={`flex flex-col items-center gap-2 ${SLOT_WIDTH_CLASS}`}>
                <div className={`flex ${SLOT_LABEL_HEIGHT_CLASS} items-center justify-center`}>
                  <p className="text-center text-[10px] uppercase leading-tight tracking-wide text-slate-500">Preview</p>
                </div>
                <div className={SLOT_SIZE_CLASS}>
                  {previewItem ? (
                    <InventorySlot
                      slotId="master-forge-preview"
                      filled
                      sizeClassName={SLOT_SIZE_CLASS}
                      icon={getItemIcon(previewTemplate?.slot_type)}
                      iconSrc={getGearIconSrc(previewTemplate?.name)}
                      qualityColor={getQualityColor(previewItem.quality_tier)}
                      label={
                        previewTemplate
                          ? formatItemDisplayName(previewTemplate.name, previewItem.quality_tier, previewItem.composition_level)
                          : undefined
                      }
                      tooltip={buildGearTooltip(previewItem, previewTemplate ?? undefined)}
                    />
                  ) : (
                    <InventorySlot slotId="master-forge-preview-empty" filled={false} sizeClassName={SLOT_SIZE_CLASS} />
                  )}
                </div>
              </div>
            </div>

            {!selectedItem && equippedEntries.length > 0 && (
              <div className="w-full max-w-sm">
                <p className="mb-1 text-center text-[10px] uppercase tracking-wide text-slate-500">Or pick an equipped item</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {equippedEntries.map(({ slot, itemId }) => {
                    const item = findItem(itemId)
                    const template = item ? (templates.find((t) => t.id === item.template_id) ?? null) : null
                    return (
                      <div key={slot} className="flex flex-col items-center gap-1">
                        <InventorySlot
                          slotId={`equipped-${slot}`}
                          filled={Boolean(item)}
                          sizeClassName={SLOT_SIZE_CLASS}
                          icon={getItemIcon(template?.slot_type)}
                          iconSrc={getGearIconSrc(template?.name)}
                          qualityColor={item ? getQualityColor(item.quality_tier) : undefined}
                          tooltip={item ? buildGearTooltip(item, template ?? undefined) : undefined}
                          label={EQUIP_SLOT_LABELS[slot]}
                          onClick={() => handleSelectItem(itemId)}
                        />
                        <span className="text-[9px] text-slate-500">{EQUIP_SLOT_LABELS[slot]}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

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
                <p className="text-center text-[11px] text-slate-600">Drag an item into the Upgrade Slot, or tap one you have equipped.</p>
              ) : blockedReason ? (
                <p className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-3 text-center text-[11px] text-amber-400">
                  {blockedReason}
                </p>
              ) : (
                cost !== null && (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-center text-xs text-slate-400">
                      Guaranteed success — costs <span className="font-semibold text-slate-200">{cost}</span>{' '}
                      {upgradeType === 'quality' ? `Fallen Star${cost === 1 ? '' : 's'}` : `Comet${cost === 1 ? '' : 's'}`}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || !canConfirm}
                        onClick={() => void handleConfirm()}
                        className="rounded-lg border border-emerald-600 bg-emerald-500/10 px-4 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy ? 'Working…' : 'Confirm Master Upgrade'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleRemove}
                        className="rounded-lg border border-slate-700 px-4 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          <InventoryPanel columns={5} reservedItemIds={selectedItemId ? [selectedItemId] : []} onTileDrop={handleTileDrop} />
        </DragDropProvider>
      )}
    </div>
  )
}
