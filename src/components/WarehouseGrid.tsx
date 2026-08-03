import { useState } from 'react'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import TooltipActionPopover from './TooltipActionPopover'
import { buildGearTooltip, getGearIconSrc, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import {
  DRAGONBALL_COLOR,
  DRAGONBALL_ICON_SRC,
  MATERIAL_COLOR,
  METEOR_ICON_SRC,
  buildDragonballTooltip,
  buildMeteorTooltip,
} from '../game/items/forgeCosts'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import { WAREHOUSE_SLOT_CAP, useWarehouseStore } from '../game/items/useWarehouseStore'

// The Bank's own 40-slot grid — fully account-wide now (2026-08-03, Bank tab
// rework, confirmed with the user): any of an account's 5 characters can see
// and withdraw the same shared items here, not just whichever character
// deposited them. The dead legacy fungible-token system (warehouse_items)
// has been removed entirely — see the migration's own comment
// (supabase/migrations/20260803080000_bank_account_wide.sql). Banked stones
// no longer render as individual grid tiles here either — they moved into
// BankSquares.tsx as one square per tier (a cleaner fit than dozens of
// non-stacking stone tiles sharing an account-wide grid). What's left is
// just banked gear (real, identity-preserving items, non-stacking) and
// banked Meteor/DragonBall units.
interface WarehouseGridProps {
  // The character claiming a withdrawal — always the active character (no
  // character-picker UI for this pass), passed through to
  // withdrawItemFromStorage/withdrawCurrencyItem as the recipient.
  characterId: string
}

type SelectedBankedSlot = { kind: 'item'; id: string } | { kind: 'currency'; currencyType: 'meteor' | 'dragonball' } | null

export default function WarehouseGrid({ characterId }: WarehouseGridProps) {
  const bankedItems = useWarehouseStore((state) => state.bankedItems)
  const busy = useWarehouseStore((state) => state.busy)
  const fullMessage = useWarehouseStore((state) => state.fullMessage)
  const withdrawItemFromStorage = useWarehouseStore((state) => state.withdrawItemFromStorage)
  const withdrawCurrencyItem = useWarehouseStore((state) => state.withdrawCurrencyItem)
  const clearFullMessage = useWarehouseStore((state) => state.clearFullMessage)
  const templates = useItemTemplatesStore((state) => state.templates)

  const meteorBankCount = usePlayerRecordStore((state) => state.meteorBankCount)
  const dragonballBankCount = usePlayerRecordStore((state) => state.dragonballBankCount)

  const [selectedBankedSlot, setSelectedBankedSlot] = useState<SelectedBankedSlot>(null)
  const [bankedPopoverAnchorRect, setBankedPopoverAnchorRect] = useState<DOMRect | null>(null)
  const [bankedActionBusy, setBankedActionBusy] = useState(false)
  const [bankedActionError, setBankedActionError] = useState<string | null>(null)

  // Same greedy budget-clamp InventoryPanel uses for its own non-stacking
  // tiles, just against whatever's left after banked gear items have already
  // claimed a slot each.
  const baseBudget = Math.max(0, WAREHOUSE_SLOT_CAP - bankedItems.length)
  const meteorShown = Math.min(meteorBankCount, baseBudget)
  const bankedMeteorTiles = Array.from({ length: meteorShown }, (_, index) => index)
  const remainingAfterMeteors = Math.max(0, baseBudget - bankedMeteorTiles.length)
  const dragonballShown = Math.min(dragonballBankCount, remainingAfterMeteors)
  const bankedDragonballTiles = Array.from({ length: dragonballShown }, (_, index) => index)

  const occupiedCount = bankedItems.length + meteorShown + dragonballShown
  const emptySlotCount = Math.max(0, WAREHOUSE_SLOT_CAP - occupiedCount)

  const selectedBankedItem =
    selectedBankedSlot?.kind === 'item' ? bankedItems.find((item) => item.id === selectedBankedSlot.id) : undefined
  const selectedBankedItemTemplate = selectedBankedItem && templates.find((t) => t.id === selectedBankedItem.template_id)
  const selectedBankedCurrencyType = selectedBankedSlot?.kind === 'currency' ? selectedBankedSlot.currencyType : undefined

  const bankedSlotKey = (slot: NonNullable<SelectedBankedSlot>): string =>
    slot.kind === 'item' ? `item:${slot.id}` : `currency:${slot.currencyType}`

  const toggleBankedSlot = (slot: NonNullable<SelectedBankedSlot>, anchorRect: DOMRect) => {
    setBankedActionError(null)
    setSelectedBankedSlot((current) => (current && bankedSlotKey(current) === bankedSlotKey(slot) ? null : slot))
    setBankedPopoverAnchorRect(anchorRect)
  }

  const closeBankedPopover = () => {
    setSelectedBankedSlot(null)
    setBankedPopoverAnchorRect(null)
  }

  const handleWithdrawBankedItem = async (itemId: string) => {
    setBankedActionError(null)
    setBankedActionBusy(true)
    const result = await withdrawItemFromStorage(itemId, characterId)
    setBankedActionBusy(false)

    if (!result.ok) {
      setBankedActionError(result.error === 'inventory_full' ? 'Inventory is full.' : "Couldn't withdraw that item.")
      return
    }

    closeBankedPopover()
  }

  const handleWithdrawAllBankedItems = async () => {
    setBankedActionError(null)
    setBankedActionBusy(true)
    let failures = 0
    let stoppedForFullInventory = false

    for (const item of bankedItems) {
      const result = await withdrawItemFromStorage(item.id, characterId)
      if (!result.ok) {
        failures += 1
        if (result.error === 'inventory_full') {
          stoppedForFullInventory = true
          break
        }
      }
    }

    setBankedActionBusy(false)
    if (stoppedForFullInventory) {
      setBankedActionError('Inventory filled up — stopped there.')
    } else if (failures > 0) {
      setBankedActionError(`Couldn't withdraw ${failures} item${failures === 1 ? '' : 's'}.`)
    } else {
      closeBankedPopover()
    }
  }

  const handleWithdrawBankedCurrency = async (currencyType: 'meteor' | 'dragonball') => {
    setBankedActionError(null)
    setBankedActionBusy(true)
    const result = await withdrawCurrencyItem(characterId, currencyType, 1)
    setBankedActionBusy(false)

    if (!result.ok) {
      setBankedActionError(`Couldn't withdraw that ${currencyType === 'meteor' ? 'Meteor' : 'DragonBall'}.`)
      return
    }

    closeBankedPopover()
  }

  const handleWithdrawAllBankedCurrency = async (currencyType: 'meteor' | 'dragonball') => {
    const owned = currencyType === 'meteor' ? meteorBankCount : dragonballBankCount
    if (owned <= 0) {
      return
    }
    setBankedActionError(null)
    setBankedActionBusy(true)
    const result = await withdrawCurrencyItem(characterId, currencyType, owned)
    setBankedActionBusy(false)

    if (!result.ok) {
      setBankedActionError(`Couldn't withdraw your ${currencyType === 'meteor' ? 'Meteors' : 'DragonBalls'}.`)
      return
    }

    closeBankedPopover()
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Storage ({occupiedCount}/{WAREHOUSE_SLOT_CAP})
        </p>

        {/* Responsive tracks matching InventoryPanel's own fix (3.5rem below
            `lg`, unchanged 4rem at `lg`+). overflow-x-auto is the same
            defensive backstop. 5 columns (not 8) — matches Forge/Combat's own
            InventoryPanel `columns={5}` convention below it on this same page. */}
        <div className="mt-2 overflow-x-auto">
          <div className="grid grid-cols-[repeat(5,3.5rem)] gap-1.5 lg:grid-cols-[repeat(5,4rem)]">
            {/* Banked gear tiles — real, identity-preserving items,
                non-stacking, no badge (no count to show — each is its own
                tile), same quality-tinted border/icon as an Inventory tile.
                Account-wide: may belong to any of the account's characters. */}
            {bankedItems.map((item) => {
              const template = templates.find((t) => t.id === item.template_id)
              const icon = getItemIcon(template?.slot_type)
              const iconSrc = getGearIconSrc(template?.name)

              return (
                <div
                  key={item.id}
                  data-tooltip-action-anchor
                  onClick={(event) => toggleBankedSlot({ kind: 'item', id: item.id }, event.currentTarget.getBoundingClientRect())}
                >
                  <InventorySlot
                    slotId={item.id}
                    filled
                    sizeClassName={SLOT_SIZE_CLASS}
                    qualityColor={getQualityColor(item.quality_tier)}
                    icon={icon}
                    iconSrc={iconSrc}
                    label={template?.name ?? 'Unknown item'}
                    selected={selectedBankedSlot?.kind === 'item' && selectedBankedSlot.id === item.id}
                  />
                </div>
              )
            })}

            {/* Banked Meteor/DragonBall tiles — same non-stacking convention. */}
            {bankedMeteorTiles.map((index) => (
              <div
                key={`banked-meteor-${index}`}
                data-tooltip-action-anchor
                onClick={(event) => toggleBankedSlot({ kind: 'currency', currencyType: 'meteor' }, event.currentTarget.getBoundingClientRect())}
              >
                <InventorySlot
                  slotId={`banked-meteor-${index}`}
                  filled
                  sizeClassName={SLOT_SIZE_CLASS}
                  iconSrc={METEOR_ICON_SRC}
                  qualityColor={MATERIAL_COLOR}
                  label="Meteor (Storage)"
                  selected={selectedBankedSlot?.kind === 'currency' && selectedBankedSlot.currencyType === 'meteor'}
                />
              </div>
            ))}

            {bankedDragonballTiles.map((index) => (
              <div
                key={`banked-dragonball-${index}`}
                data-tooltip-action-anchor
                onClick={(event) =>
                  toggleBankedSlot({ kind: 'currency', currencyType: 'dragonball' }, event.currentTarget.getBoundingClientRect())
                }
              >
                <InventorySlot
                  slotId={`banked-dragonball-${index}`}
                  filled
                  sizeClassName={SLOT_SIZE_CLASS}
                  iconSrc={DRAGONBALL_ICON_SRC}
                  qualityColor={DRAGONBALL_COLOR}
                  label="DragonBall (Storage)"
                  selected={selectedBankedSlot?.kind === 'currency' && selectedBankedSlot.currencyType === 'dragonball'}
                />
              </div>
            ))}

            {Array.from({ length: emptySlotCount }, (_, index) => (
              <InventorySlot key={`empty-${index}`} slotId={`wh-empty-${index}`} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
            ))}
          </div>
        </div>

        {fullMessage && (
          <div className="mt-2 flex items-center justify-between rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
            <span>{fullMessage}</span>
            <button type="button" onClick={clearFullMessage} className="underline hover:text-amber-200">
              Dismiss
            </button>
          </div>
        )}
        {bankedActionError && <p className="mt-2 text-xs text-amber-400">{bankedActionError}</p>}
      </div>

      {selectedBankedItem && bankedPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={bankedPopoverAnchorRect}
          tooltip={buildGearTooltip(selectedBankedItem, selectedBankedItemTemplate)}
          actions={[
            {
              label: bankedActionBusy ? 'Withdrawing…' : 'Withdraw',
              onClick: () => void handleWithdrawBankedItem(selectedBankedItem.id),
              disabled: bankedActionBusy || busy,
            },
            {
              label: 'Withdraw All',
              onClick: () => void handleWithdrawAllBankedItems(),
              disabled: bankedActionBusy || busy,
            },
          ]}
          onClose={closeBankedPopover}
        />
      )}

      {selectedBankedCurrencyType && bankedPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={bankedPopoverAnchorRect}
          tooltip={selectedBankedCurrencyType === 'meteor' ? buildMeteorTooltip() : buildDragonballTooltip()}
          actions={[
            {
              label: bankedActionBusy ? 'Withdrawing…' : 'Withdraw',
              onClick: () => void handleWithdrawBankedCurrency(selectedBankedCurrencyType),
              disabled: bankedActionBusy || busy,
            },
            {
              label: 'Withdraw All',
              onClick: () => void handleWithdrawAllBankedCurrency(selectedBankedCurrencyType),
              disabled: bankedActionBusy || busy,
            },
          ]}
          onClose={closeBankedPopover}
        />
      )}
    </div>
  )
}
