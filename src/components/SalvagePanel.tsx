import { useState } from 'react'
import { motion } from 'framer-motion'
import ForgeTwoColumnLayout from './ForgeTwoColumnLayout'
import InventoryPanel from './InventoryPanel'
import InventorySlot, { SLOT_LABEL_HEIGHT_CLASS, SLOT_SIZE_CLASS, SLOT_WIDTH_CLASS } from './InventorySlot'
import { DragDropProvider } from './dragDrop'
import { useDraggableTile, useIsDropTarget } from './dragDropContext'
import { buildGearTooltip, formatItemDisplayName, formatItemLevel, getGearIconSrc, getItemIcon, getQualityColor, previewSalvageApValue } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../game/items/useItemTemplatesStore'
import { useMarketplaceStore } from '../game/marketplace/useMarketplaceStore'
import { useMailStore } from '../game/marketplace/useMailStore'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import { useSalvageRevealStore } from '../game/items/useSalvageRevealStore'

// Bulk-salvageable tiers (2026-08-09, per the user's request) — deliberately
// excludes Normal (no salvage value, see isWorthless below) and Ascended
// (rare enough that a one-click "salvage everything" button is more likely
// to be a costly misclick than a convenience — bulk stays scoped to the
// three tiers a player actually accumulates in volume).
const BULK_SALVAGE_TIERS = ['tempered', 'infused', 'radiant'] as const
type BulkSalvageTier = (typeof BULK_SALVAGE_TIERS)[number]

const BULK_TIER_LABEL: Record<BulkSalvageTier, string> = {
  tempered: 'Tempered',
  infused: 'Infused',
  radiant: 'Radiant',
}

// Bulk salvage runs the exact same per-item animation as a single salvage
// (see SALVAGE_ANIMATION_MS below), just looped sequentially — so the total
// time really is count * SALVAGE_ANIMATION_MS, not a separate faster path.
// Formats that as a short human estimate for the button label/progress text.
function formatDurationEstimate(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  if (totalSeconds < 60) {
    return `~${totalSeconds}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `~${minutes}m` : `~${minutes}m ${seconds}s`
}

// How long the salvaging animation plays before the RPC actually fires
// (confirmed with the user, 2026-08-07: "a little load bar appears for a
// 1.5 second salvaging action animation"). Purely cosmetic pacing — the real
// outcome is still decided entirely by salvage_item, this just delays
// revealing it.
const SALVAGE_ANIMATION_MS = 1500
const RESULT_DISPLAY_MS = 1800

interface SalvageSlotProps {
  item: ItemInstance | null
  template: ItemTemplate | undefined
  onRemove: () => void
}

// Mirrors ForgeUpgradeSlot's exact drag-target shape (single slot,
// data-drop-zone="salvage") — confirmed with the user: "This should be a
// drag and drop box," replacing the earlier bulk-checkbox-select flow.
function SalvageSlot({ item, template, onRemove }: SalvageSlotProps) {
  const icon = getItemIcon(template?.slot_type)
  const iconSrc = getGearIconSrc(template?.name)
  const drag = useDraggableTile({
    enabled: Boolean(item),
    payload: item ? { id: item.id, icon, iconSrc, qualityColor: getQualityColor(item.quality_tier) } : null,
    onDrop: () => onRemove(),
  })
  const isDropTarget = useIsDropTarget('salvage')

  return (
    <div className={`flex flex-col items-center gap-2 ${SLOT_WIDTH_CLASS}`}>
      <div className={`flex ${SLOT_LABEL_HEIGHT_CLASS} items-center justify-center`}>
        <p className="text-center text-[10px] uppercase leading-tight tracking-wide text-slate-500">Salvage Slot</p>
      </div>

      <div
        data-drop-zone="salvage"
        className={`${SLOT_SIZE_CLASS} shrink-0 rounded-lg transition-shadow ${
          isDropTarget ? 'ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]' : ''
        }`}
      >
        <InventorySlot
          slotId="salvage-slot"
          filled={Boolean(item)}
          sizeClassName={SLOT_SIZE_CLASS}
          emptyHint="Drop item here"
          qualityColor={item ? getQualityColor(item.quality_tier) : undefined}
          icon={item ? icon : undefined}
          iconSrc={item ? iconSrc : undefined}
          label={item ? (template ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level) : 'Unknown item') : undefined}
          tooltip={item ? buildGearTooltip(item, template ?? undefined) : undefined}
          draggable={drag.draggable}
          dragging={drag.dragging}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          onPointerCancel={drag.onPointerCancel}
        />
      </div>

      {item && (
        <div className="text-center">
          <p className="text-xs font-medium text-slate-200">
            {template ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level) : 'Unknown item'}
          </p>
          <p className="text-[10px] text-slate-500">{formatItemLevel(item.level)}</p>
          <button type="button" onClick={onRemove} className="mt-1 text-[10px] text-slate-500 underline hover:text-slate-300">
            Remove
          </button>
        </div>
      )}
    </div>
  )
}

// Forge's Salvage tab (confirmed with the user, 2026-08-07 — supersedes the
// original bulk-checkbox-select version from the same day): drag unwanted
// gear into a single slot (mirrors ForgeUpgradeSlot), then Salvage plays a
// 1.5s animated loading bar before the RPC actually resolves and the
// Ascension Points land. No gold — see salvage_item's own per-quality-tier
// AP table (Tempered 1/Infused 2/Radiant 3/Ascended 4, Normal 0 — matches
// sell_item's own AP payout exactly, Salvage's only difference from Sell is
// forfeiting the gold).
interface SalvagePanelProps {
  onBack: () => void
}

export default function SalvagePanel({ onBack }: SalvagePanelProps) {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const salvageItem = useInventoryStore((state) => state.salvageItem)
  const ascensionPoints = usePlayerRecordStore((state) => state.ascensionPoints)
  const showSalvageReveal = useSalvageRevealStore((state) => state.show)

  // Same "what's actually mine to touch right now" filter InventoryPanel
  // applies to its own visibleItems — equipped/listed/banked/unclaimed-mail
  // gear is excluded from the drag grid entirely, so bulk salvage (which
  // reads straight from the store, not from the grid) needs the identical
  // filter or it'd offer to salvage things the player can't actually select.
  const equippedIds = useEquipmentStore((state) => state.equippedIds)
  const myListings = useMarketplaceStore((state) => state.myListings)
  const mailEntries = useMailStore((state) => state.entries)

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'salvaging' | 'bulk-salvaging'>('idle')
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [bulkProgress, setBulkProgress] = useState<{ tier: BulkSalvageTier; total: number; completed: number; apTotal: number } | null>(
    null,
  )

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null
  const selectedTemplate = selectedItem ? templates.find((t) => t.id === selectedItem.template_id) : undefined
  const apValue = selectedItem ? previewSalvageApValue(selectedItem.quality_tier) : 0
  const isWorthless = selectedItem?.quality_tier === 'normal'

  const equippedItemIds = new Set(Object.values(equippedIds).filter((id): id is string => Boolean(id)))
  const listedItemIds = new Set(myListings.filter((listing) => listing.status === 'active').map((listing) => listing.item_id))
  const mailItemIds = new Set(mailEntries.map((entry) => entry.item_id))
  const salvageableItems = items.filter(
    (item) =>
      item.location !== 'bank' &&
      !equippedItemIds.has(item.id) &&
      !listedItemIds.has(item.id) &&
      !mailItemIds.has(item.id) &&
      item.id !== selectedItemId,
  )

  const bulkGroups = BULK_SALVAGE_TIERS.map((tier) => {
    const tierItems = salvageableItems.filter((item) => item.quality_tier === tier)
    return {
      tier,
      items: tierItems,
      apEstimate: tierItems.length * previewSalvageApValue(tier),
      timeEstimateMs: tierItems.length * SALVAGE_ANIMATION_MS,
    }
  })

  const handleDropItemId = (itemId: string) => {
    if (!items.some((item) => item.id === itemId) || phase !== 'idle') {
      return
    }
    setSelectedItemId(itemId)
    setResult(null)
  }

  const handleRemove = () => {
    if (phase !== 'idle') {
      return
    }
    setSelectedItemId(null)
    setResult(null)
  }

  const handleTileDrop = (overTarget: string, id: string) => {
    if (overTarget === 'salvage') {
      handleDropItemId(id)
    }
  }

  const handleSalvage = () => {
    if (!selectedItem || phase !== 'idle') {
      return
    }

    setPhase('salvaging')
    setResult(null)

    setTimeout(async () => {
      const outcome = await salvageItem(selectedItem.id)
      setPhase('idle')

      if (!outcome.ok) {
        setResult({ success: false, message: "Couldn't salvage that item." })
        return
      }

      if (typeof outcome.apGained === 'number') {
        showSalvageReveal(outcome.apGained)
      }
      setResult({ success: true, message: `Salvaged for ${outcome.apGained ?? 0} AP.` })
      setSelectedItemId(null)

      setTimeout(() => setResult(null), RESULT_DISPLAY_MS)
    }, SALVAGE_ANIMATION_MS)
  }

  // Runs the exact same per-item animation/RPC pair handleSalvage uses,
  // looped sequentially over every visible item of one tier — so the
  // pre-click time estimate (bulkGroups' timeEstimateMs) matches how long
  // this actually takes, not a separate faster bulk path. Individual
  // failures don't abort the run (matches ShopPanel's own bulk-sell loop) —
  // they're just tallied and reported in the final summary.
  const handleBulkSalvage = async (tier: BulkSalvageTier) => {
    if (phase !== 'idle') {
      return
    }
    const group = bulkGroups.find((g) => g.tier === tier)
    if (!group || group.items.length === 0) {
      return
    }

    setPhase('bulk-salvaging')
    setResult(null)
    setBulkProgress({ tier, total: group.items.length, completed: 0, apTotal: 0 })

    let apTotal = 0
    let completed = 0
    let failures = 0

    for (const item of group.items) {
      await new Promise((resolve) => setTimeout(resolve, SALVAGE_ANIMATION_MS))
      const outcome = await salvageItem(item.id)
      if (outcome.ok && typeof outcome.apGained === 'number') {
        apTotal += outcome.apGained
      } else {
        failures += 1
      }
      completed += 1
      setBulkProgress({ tier, total: group.items.length, completed, apTotal })
    }

    if (apTotal > 0) {
      showSalvageReveal(apTotal)
    }

    setPhase('idle')
    setBulkProgress(null)
    const salvagedCount = group.items.length - failures
    const label = BULK_TIER_LABEL[tier]
    setResult({
      success: failures === 0,
      message:
        failures === 0
          ? `Salvaged ${salvagedCount} ${label} item${salvagedCount === 1 ? '' : 's'} for ${apTotal} AP.`
          : `Salvaged ${salvagedCount}/${group.items.length} ${label} items for ${apTotal} AP (${failures} failed).`,
    })
    setTimeout(() => setResult(null), RESULT_DISPLAY_MS)
  }

  return (
    <DragDropProvider>
      <ForgeTwoColumnLayout
        title="Salvage"
        onBack={onBack}
        inventory={<InventoryPanel columns={5} reservedItemIds={selectedItemId ? [selectedItemId] : []} onTileDrop={handleTileDrop} />}
      >
        <div className="w-full max-w-xs rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-center text-xs text-slate-400">
          <p>Drag in unwanted gear to salvage it for Ascension Points — no gold, but works on any quality tier.</p>
          <p className="mt-1 text-purple-300">Ascension Points: {ascensionPoints}</p>
        </div>

        <div className="w-full max-w-xs space-y-2">
          <p className="text-center text-[11px] uppercase tracking-wide text-slate-500">Bulk Salvage</p>
          {bulkGroups.map((group) => (
            <button
              key={group.tier}
              type="button"
              disabled={phase !== 'idle' || group.items.length === 0}
              onClick={() => void handleBulkSalvage(group.tier)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-purple-800/60 bg-purple-500/5 px-3 py-2 text-left hover:bg-purple-500/10 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent"
            >
              <span className={`text-xs font-medium ${group.items.length === 0 ? 'text-slate-600' : 'text-purple-300'}`}>
                Salvage All {BULK_TIER_LABEL[group.tier]} ({group.items.length})
              </span>
              <span className="shrink-0 text-[10px] text-slate-500">
                {group.items.length > 0 ? `${group.apEstimate} AP · ${formatDurationEstimate(group.timeEstimateMs)}` : 'None owned'}
              </span>
            </button>
          ))}
        </div>

        <SalvageSlot item={selectedItem} template={selectedTemplate} onRemove={handleRemove} />

        {phase === 'bulk-salvaging' && bulkProgress && (
          <div className="w-full max-w-xs">
            <p className="mb-1 text-center text-[11px] text-slate-500">
              Salvaging {BULK_TIER_LABEL[bulkProgress.tier]}… {bulkProgress.completed}/{bulkProgress.total} ·{' '}
              {formatDurationEstimate((bulkProgress.total - bulkProgress.completed) * SALVAGE_ANIMATION_MS)} left
            </p>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
              <motion.div
                className="h-full rounded-full bg-purple-500"
                animate={{ width: `${(bulkProgress.completed / bulkProgress.total) * 100}%` }}
                transition={{ duration: SALVAGE_ANIMATION_MS / 1000, ease: 'linear' }}
              />
            </div>
          </div>
        )}

        {phase === 'salvaging' && (
          <div className="w-full max-w-xs">
            <p className="mb-1 text-center text-[11px] text-slate-500">Salvaging…</p>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
              <motion.div
                className="h-full rounded-full bg-purple-500"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: SALVAGE_ANIMATION_MS / 1000, ease: 'linear' }}
              />
            </div>
          </div>
        )}

        {result && (
          <div
            className={`w-full max-w-xs rounded-xl border p-2.5 text-center text-xs ${
              result.success ? 'border-purple-600 bg-purple-500/10 text-purple-300' : 'border-red-800 bg-red-500/10 text-red-300'
            }`}
          >
            {result.message}
          </div>
        )}

        {selectedItem && phase === 'idle' && !result && (
          <button
            type="button"
            disabled={isWorthless}
            onClick={handleSalvage}
            title={isWorthless ? 'Normal-quality gear has no salvage value — sell it in the Shop instead.' : undefined}
            className="w-full max-w-xs rounded-lg border border-purple-600 bg-purple-500/10 px-4 py-2 text-sm font-medium text-purple-300 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-transparent disabled:text-slate-500"
          >
            {isWorthless ? 'No salvage value' : `Salvage (${apValue} AP)`}
          </button>
        )}
      </ForgeTwoColumnLayout>
    </DragDropProvider>
  )
}
