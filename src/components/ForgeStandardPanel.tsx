import { useEffect, useRef, useState, type CSSProperties } from 'react'
import EquippedGearPicker from './EquippedGearPicker'
import ForgeMaterialSlot, { type MaterialEntry } from './ForgeMaterialSlot'
import ForgePreviewSlot from './ForgePreviewSlot'
import ForgeTwoColumnLayout from './ForgeTwoColumnLayout'
import ForgeUpgradeSlot from './ForgeUpgradeSlot'
import { DragDropProvider } from './dragDrop'
import InventoryPanel from './InventoryPanel'
import { Button } from './ui/Button'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { nextQualityTier } from '../game/items/equipmentBonus'
import {
  effectiveCurrencyAvailable,
  exceedsCharacterLevel,
  findNextTemplateInChain,
  isFallenStarDragId,
  isCometDragId,
  isFallenStarScrollDragId,
  isCometScrollDragId,
  levelUpgradeCurrency,
  previewLevelUpgradeCost,
  previewQualityUpgradeCost,
} from '../game/items/forgeCosts'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useForgeStore } from '../game/items/useForgeStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useMarketplaceStore } from '../game/marketplace/useMarketplaceStore'
import { useMailStore } from '../game/marketplace/useMailStore'

const RESULT_DISPLAY_MS = 2600

// VIP Auto-Forge repeat (v1.108.0, Level Upgrade only) — paced one attempt
// per second, matching the user's own description of the feature.
const AUTO_FORGE_TICK_MS = 1000

// Same violet as VipStatusHud.tsx/VipSettingsModal.tsx's VIP_TINT — this
// toggle is VIP-gated, so it borrows the app's one established "VIP" color.
const VIP_TINT = '#8b5cf6'
const VIP_TINT_STYLE = { '--ascension-tint': VIP_TINT } as CSSProperties

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
    case 'not_enough_fallen_star_scrolls':
      return 'Not enough Fallen Star Scrolls.'
    case 'not_enough_comet_scrolls':
      return 'Not enough Comet Scrolls.'
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
    case 'weapon_requires_master_forge':
      return 'Weapons past level 120 can only be Level Upgraded at the Master Forge.'
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
  const characterLevel = useProgressionStore((state) => state.level)
  const isEquipped = useEquipmentStore((state) => state.isEquipped)
  const busy = useForgeStore((state) => state.busy)
  const qualityUpgrade = useForgeStore((state) => state.qualityUpgrade)
  const levelUpgrade = useForgeStore((state) => state.levelUpgrade)
  const qualityUpgradeScroll = useForgeStore((state) => state.qualityUpgradeScroll)
  const levelUpgradeScroll = useForgeStore((state) => state.levelUpgradeScroll)

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [materialEntries, setMaterialEntries] = useState<MaterialEntry[]>([])
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null)
  const [hold, setHold] = useState(false)

  // VIP Auto-Forge repeat (Level Upgrade only) — once ticked, keeps calling
  // levelUpgrade once/sec against whichever same-slot-type/same-level item in
  // Inventory is next eligible, until Comets or matching items run out.
  const vipExpiresAt = useCharacterStore((state) => state.vipExpiresAt)
  const isVipActive = Boolean(vipExpiresAt && new Date(vipExpiresAt).getTime() > Date.now())
  const [autoRepeat, setAutoRepeat] = useState(false)
  const [autoRepeatSummary, setAutoRepeatSummary] = useState<string | null>(null)
  const autoRepeatTargetRef = useRef<{ slotType: string; level: number } | null>(null)
  const autoRepeatStatsRef = useRef({ attempts: 0, successes: 0 })

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null
  const selectedTemplate = selectedItem ? (templates.find((t) => t.id === selectedItem.template_id) ?? null) : null

  const materialMode: MaterialMode | null =
    materialEntries.length === 0 || materialEntries[0].kind !== 'currency'
      ? null
      : materialEntries[0].currencyType === 'comet'
        ? 'level'
        : 'quality'

  // A dropped Comet Scroll/Fallen Star Scroll (2026-08-13) picks the same
  // upgrade path as its loose-unit counterpart, but triggers the batch RPC
  // (10 chained attempts off one Scroll) instead of a single attempt.
  const isBatch = materialEntries.length > 0 && materialEntries[0].kind === 'currency' && Boolean(materialEntries[0].isScroll)

  useEffect(() => {
    if (!attemptResult) {
      return undefined
    }

    const timeout = setTimeout(() => setAttemptResult(null), RESULT_DISPLAY_MS)
    return () => clearTimeout(timeout)
  }, [attemptResult])

  useEffect(() => {
    if (!autoRepeat) {
      return undefined
    }
    if (!isVipActive || !selectedItem || !selectedTemplate || materialMode !== 'level') {
      setAutoRepeat(false)
      return undefined
    }

    autoRepeatTargetRef.current = { slotType: selectedTemplate.slot_type, level: selectedItem.level }
    autoRepeatStatsRef.current = { attempts: 0, successes: 0 }
    setAutoRepeatSummary(null)

    let cancelled = false
    let timeoutId: number | undefined

    const stop = (reason: string) => {
      if (cancelled) {
        return
      }
      cancelled = true
      const { attempts, successes } = autoRepeatStatsRef.current
      setAutoRepeatSummary(attempts === 0 ? reason : `${reason} (${successes}/${attempts} upgrades succeeded)`)
      setAutoRepeat(false)
    }

    const tick = async () => {
      if (cancelled) {
        return
      }
      const target = autoRepeatTargetRef.current
      if (!target) {
        return
      }

      const currentVipExpiresAt = useCharacterStore.getState().vipExpiresAt
      const stillVip = Boolean(currentVipExpiresAt && new Date(currentVipExpiresAt).getTime() > Date.now())
      if (!stillVip) {
        stop('Auto-Forge stopped: VIP expired.')
        return
      }
      if (useCurrencyStore.getState().comets < 1) {
        stop('Auto-Forge stopped: out of Comets.')
        return
      }

      const currentItems = useInventoryStore.getState().items
      const currentTemplates = useItemTemplatesStore.getState().templates
      const checkEquipped = useEquipmentStore.getState().isEquipped
      const myListings = useMarketplaceStore.getState().myListings
      const checkListed = (itemId: string) => myListings.some((listing) => listing.status === 'active' && listing.item_id === itemId)
      const mailEntries = useMailStore.getState().entries
      const checkUnclaimedMail = (itemId: string) => mailEntries.some((entry) => entry.item_id === itemId && entry.claimed_at === null)

      const nextItem = currentItems.find((item) => {
        if (item.location === 'bank' || item.locked || item.level !== target.level) {
          return false
        }
        if (checkEquipped(item.id) || checkListed(item.id) || checkUnclaimedMail(item.id)) {
          return false
        }
        return currentTemplates.find((entry) => entry.id === item.template_id)?.slot_type === target.slotType
      })

      if (!nextItem) {
        stop('Auto-Forge stopped: no more matching items.')
        return
      }

      autoRepeatStatsRef.current.attempts += 1
      const result = await levelUpgrade(nextItem.id)
      if (result.ok && result.upgraded) {
        autoRepeatStatsRef.current.successes += 1
      }

      if (!cancelled) {
        timeoutId = window.setTimeout(() => void tick(), AUTO_FORGE_TICK_MS)
      }
    }

    timeoutId = window.setTimeout(() => void tick(), AUTO_FORGE_TICK_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
    // Deliberately keyed on autoRepeat alone — once started, the loop commits
    // to the target captured above and keeps running independent of further
    // changes to the currently-staged item/material in the UI (see the
    // checkbox's own render condition below, which stays visible/toggleable
    // even after the Upgrade Slot is cleared).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRepeat])

  const handleDropItemId = (itemId: string) => {
    const item = items.find((entry) => entry.id === itemId)
    if (!item || materialEntries.some((entry) => entry.id === itemId)) {
      return
    }

    // The Quiver has no stats and no upgrade chain — Level Upgrade already
    // has nowhere to go, and Quality Upgrade would just burn Fallen Stars
    // for a cosmetic tier with nothing to scale. Excluded from this tile
    // entirely rather than left to fail silently once dropped. Promotion
    // materials (Lunar Chest, Umbrite Ore, Jade Shard, Opaline Gem) and
    // Mining Ore (Iron/Silver/Gold) are excluded for the same reason —
    // they're plain quest/currency items, not gear, and the backend now
    // rejects a Quality Upgrade on either slot_type anyway.
    const template = templates.find((entry) => entry.id === item.template_id)
    if (template?.slot_type === 'quiver' || template?.slot_type === 'promotion-material' || template?.slot_type === 'material') {
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
      return
    }

    if (isCometScrollDragId(id)) {
      setMaterialEntries([{ kind: 'currency', id, currencyType: 'comet', isScroll: true }])
      return
    }

    if (isFallenStarScrollDragId(id)) {
      setMaterialEntries([{ kind: 'currency', id, currencyType: 'fallen_star', isScroll: true }])
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

  // An equipped item can't Level Upgrade past the character's own level —
  // it would become un-equippable with no way back short of another Level
  // Upgrade. An item sitting in ordinary Inventory has no such restriction
  // (deliberately, per the user — they just won't be able to re-equip it).
  const isSelectedEquipped = selectedItem ? isEquipped(selectedItem.id) : false
  const blockedByEquipLevel = materialMode === 'level' && isSelectedEquipped && exceedsCharacterLevel(nextLevelTemplate, characterLevel)

  // A weapon at required_level 120+ is Master-Forge-exclusive from here on —
  // the regular Forge (single attempt or Comet Scroll batch) can't touch it
  // at all, even though a next template genuinely exists in its chain (so
  // isMaxLevel alone wouldn't catch this). Same 120+ boundary as
  // levelUpgradeCurrency's Master Forge currency switch — not maxed takes
  // priority (matches the SQL's own check order).
  const weaponNeedsMasterForge =
    !isMaxLevel && selectedTemplate ? levelUpgradeCurrency(selectedTemplate.slot_type, selectedTemplate.required_level) === 'fallen_star' : false

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
      : weaponNeedsMasterForge
        ? 'Weapons past level 120 can only be Level Upgraded at the Master Forge.'
        : blockedByEquipLevel && nextLevelTemplate
          ? `This would make the item level ${nextLevelTemplate.required_level}, above your own level ${characterLevel}. Unequip it first if you want to upgrade past your level.`
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

  // Same visibility condition the old checkbox used — level-mode item staged
  // (even a maxed one, so the toggle stays reachable) OR already running,
  // since the loop keeps going after the Upgrade Slot is cleared out from
  // under it (see the effect below).
  const canAutoRepeatHere = materialMode === 'level' && Boolean(selectedItem) && !blockedByEquipLevel && !weaponNeedsMasterForge
  const showAutoRepeat = autoRepeat || canAutoRepeatHere
  const confirmVisible = Boolean(previewItem) && !blockedByEquipLevel && !weaponNeedsMasterForge

  const autoRepeatButton = (
    <div
      className={`ascension-chip-frame is-tinted ${isVipActive ? 'is-interactive' : 'opacity-40'} ${
        autoRepeat ? 'shadow-[0_0_14px_rgba(139,92,246,0.55)]' : ''
      }`}
      style={VIP_TINT_STYLE}
    >
      <button
        type="button"
        onClick={() => setAutoRepeat((current) => !current)}
        disabled={!isVipActive}
        aria-pressed={autoRepeat}
        title={isVipActive ? 'Auto-repeat: 1 Level Upgrade/sec across every other matching item' : 'Requires VIP'}
        className="ascension-chip-inner px-4 py-2.5 text-sm font-bold uppercase tracking-[0.08em] text-violet-100 transition disabled:cursor-not-allowed"
      >
        Auto-Repeat
      </button>
    </div>
  )

  const handleConfirm = async () => {
    if (!selectedItem || (materialMode !== 'quality' && materialMode !== 'level')) {
      return
    }
    if (materialMode === 'level' && (blockedByEquipLevel || weaponNeedsMasterForge)) {
      return
    }

    const result = isBatch
      ? materialMode === 'quality'
        ? await qualityUpgradeScroll(selectedItem.id)
        : await levelUpgradeScroll(selectedItem.id)
      : materialMode === 'quality'
        ? await qualityUpgrade(selectedItem.id)
        : await levelUpgrade(selectedItem.id)

    if (!result.ok) {
      setAttemptResult({ success: false, message: describeFailure(result.error) })
      return
    }

    const upgraded = Boolean(result.upgraded)
    setAttemptResult({
      success: upgraded,
      message: upgraded ? 'Upgrade succeeded!' : 'Upgrade failed — materials were still spent.',
    })

    // Held: item + material stay put (indefinitely, until Remove or a new
    // drop) so successive upgrade rolls can be fired without re-dragging.
    // Not held: return the item to the Inventory grid immediately rather
    // than waiting out the result banner's display timer.
    if (upgraded && !hold) {
      setSelectedItemId(null)
      setMaterialEntries([])
    }
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
          <ForgeUpgradeSlot item={selectedItem} template={selectedTemplate} onRemove={handleRemove} hold={hold} onHoldChange={setHold} />
          <ForgeMaterialSlot entries={materialEntries} templates={templates} onRemoveEntry={handleRemoveMaterial} />
          <ForgePreviewSlot previewItem={previewItem} previewTemplate={previewTemplate} slotId="forge-standard-preview" />
        </div>

        {!selectedItem && <EquippedGearPicker onSelect={handleDropItemId} />}

        <div className="w-full max-w-xs space-y-2">
          {!selectedItem ? (
            <p className="text-center text-[11px] text-slate-600">Drag an item into the Upgrade Slot, or tap one you have equipped.</p>
          ) : !materialMode ? (
            <p className="text-center text-[11px] text-slate-600">
              Drag a Comet, Fallen Star, or Scroll into the Material slot.
            </p>
          ) : (
            <>
              {isBatch && !attemptResult && (
                <p className="text-center text-[11px] text-amber-400/80">
                  Uses 1 {materialMode === 'quality' ? 'Fallen Star' : 'Comet'} Scroll — up to 10 automatic upgrade rolls.
                </p>
              )}

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

              {confirmVisible ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex justify-center gap-2">
                    {materialMode === 'level' && autoRepeatButton}
                    <Button variant="primary" disabled={busy} onClick={() => void handleConfirm()}>
                      {busy ? 'Working…' : 'Confirm'}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setMaterialEntries([])}>
                      Cancel
                    </Button>
                  </div>
                  {autoRepeatSummary && <p className="text-center text-[11px] text-amber-400/80">{autoRepeatSummary}</p>}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-3 text-center text-[11px] text-slate-600">
                  {materialMode === 'quality' ? qualityDisabledReason : levelDisabledReason}
                </p>
              )}
            </>
          )}
        </div>

        {/* Confirm/Cancel need a level-mode item staged, but Auto-Repeat must
            stay reachable even when one isn't (an already-maxed item staged,
            or the loop still running after the Upgrade Slot got cleared) —
            covered above whenever confirmVisible, this is the fallback. */}
        {showAutoRepeat && !confirmVisible && (
          <div className="flex w-full max-w-xs flex-col items-center gap-1">
            {autoRepeatButton}
            {autoRepeatSummary && <p className="text-center text-[11px] text-amber-400/80">{autoRepeatSummary}</p>}
          </div>
        )}
      </ForgeTwoColumnLayout>
    </DragDropProvider>
  )
}
