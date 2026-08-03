import { useState } from 'react'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { DraggableInventorySlot } from './dragDrop'
import TooltipActionPopover from './TooltipActionPopover'
import { buildGearTooltip, getGearIconSrc, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import type { ItemTooltipData } from '../game/items/itemTooltip'
import {
  COMPOSITION_STONE_TIERS,
  DRAGONBALL_COLOR,
  DRAGONBALL_ICON_SRC,
  MATERIAL_COLOR,
  METEOR_ICON_SRC,
  buildDragonballTooltip,
  buildMeteorTooltip,
  buildStoneTooltip,
  compositionPointValue,
} from '../game/items/forgeCosts'
import { useCompositionStore } from '../game/items/useCompositionStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { WAREHOUSE_SLOT_CAP, bankOccupiedSlotCount, useWarehouseStore } from '../game/items/useWarehouseStore'

// The Warehouse's own 40-slot grid. Two genuinely different kinds of tile
// coexist here (confirmed with the user, 2026-08-03, revised the same day
// after feedback — see the Bank Storage note on ItemInstance in
// useInventoryStore.ts):
//
// - The OLD fungible per-template count token (warehouse_items, below,
//   unchanged) — kept in place rather than removed, though nothing deposits
//   into it from the UI anymore (its only creator, the old deposit_item, is
//   no longer called — see InventoryPanel). Table was verified empty before
//   this change, so this is legacy plumbing, not live data loss.
// - The NEW banked gear/stone/Meteor/DragonBall tiles, each a real,
//   identity-preserving unit exactly mirroring how that same thing already
//   looks in Inventory (non-stacking, no points, no fungibility) — "a bank
//   slot is just an Inventory slot that happens to be in the bank."
interface WarehouseGridProps {
  characterId: string
  // Dragging a tile *out* of this grid (toward Inventory, to withdraw at the
  // free Normal tier — a shortcut for the common case; choosing a paid
  // composition tier still goes through the click-to-select detail card
  // below) calls back with whichever data-drop-zone target the tile was
  // released over — WarehousePanel (the actual owner of withdrawItem) decides
  // what to do with it, same routing pattern ForgePanel uses. See dragDrop.tsx.
  onTileDrop?: (overTarget: string, id: string) => void
}

type SelectedBankedSlot =
  | { kind: 'item'; id: string }
  | { kind: 'stone'; tier: number }
  | { kind: 'currency'; currencyType: 'meteor' | 'dragonball' }
  | null

export default function WarehouseGrid({ characterId, onTileDrop }: WarehouseGridProps) {
  const tokenItems = useWarehouseStore((state) => state.items)
  const points = useWarehouseStore((state) => state.points)
  const busy = useWarehouseStore((state) => state.busy)
  const fullMessage = useWarehouseStore((state) => state.fullMessage)
  const withdrawItem = useWarehouseStore((state) => state.withdrawItem)
  const withdrawItemFromStorage = useWarehouseStore((state) => state.withdrawItemFromStorage)
  const withdrawStoneItem = useWarehouseStore((state) => state.withdrawStoneItem)
  const withdrawCurrencyItem = useWarehouseStore((state) => state.withdrawCurrencyItem)
  const clearFullMessage = useWarehouseStore((state) => state.clearFullMessage)
  const templates = useItemTemplatesStore((state) => state.templates)

  const inventoryItems = useInventoryStore((state) => state.items)
  const stonesBanked = useCompositionStore((state) => state.stonesBanked)
  const meteorBankCount = useCurrencyStore((state) => state.meteorBankCount)
  const dragonballBankCount = useCurrencyStore((state) => state.dragonballBankCount)

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [withdrawTier, setWithdrawTier] = useState(0)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [withdrawAllBusy, setWithdrawAllBusy] = useState(false)
  const [withdrawAllError, setWithdrawAllError] = useState<string | null>(null)

  // New Bank-Storage tiles' own popover state — kept separate from the old
  // token system's selectedEntryId above, since the two are genuinely
  // different UIs (a floating popover vs. the below-grid card).
  const [selectedBankedSlot, setSelectedBankedSlot] = useState<SelectedBankedSlot>(null)
  const [bankedPopoverAnchorRect, setBankedPopoverAnchorRect] = useState<DOMRect | null>(null)
  const [bankedActionBusy, setBankedActionBusy] = useState(false)
  const [bankedActionError, setBankedActionError] = useState<string | null>(null)

  const bankedGearItems = inventoryItems.filter((item) => item.location === 'bank')

  // Same greedy budget-clamp InventoryPanel uses for its own non-stacking
  // tiles, just against whatever's left after the old tokens + new banked
  // gear items have already claimed a slot each.
  const baseStoneBudget = Math.max(0, WAREHOUSE_SLOT_CAP - tokenItems.length - bankedGearItems.length)
  const bankedStoneTiles = COMPOSITION_STONE_TIERS.reduce<{ tier: number; index: number }[]>((acc, tier) => {
    const owned = stonesBanked[String(tier)] ?? 0
    const shown = Math.min(owned, Math.max(0, baseStoneBudget - acc.length))
    for (let index = 0; index < shown; index += 1) {
      acc.push({ tier, index })
    }
    return acc
  }, [])
  const remainingAfterStones = Math.max(0, baseStoneBudget - bankedStoneTiles.length)
  const meteorShown = Math.min(meteorBankCount, remainingAfterStones)
  const bankedMeteorTiles = Array.from({ length: meteorShown }, (_, index) => index)
  const remainingAfterMeteors = Math.max(0, remainingAfterStones - bankedMeteorTiles.length)
  const dragonballShown = Math.min(dragonballBankCount, remainingAfterMeteors)
  const bankedDragonballTiles = Array.from({ length: dragonballShown }, (_, index) => index)

  const occupiedCount = bankOccupiedSlotCount()
  const emptySlotCount = Math.max(0, WAREHOUSE_SLOT_CAP - occupiedCount)
  const selectedEntry = tokenItems.find((entry) => entry.id === selectedEntryId)
  const selectedTemplate = selectedEntry && templates.find((template) => template.id === selectedEntry.template_id)
  const withdrawCost = compositionPointValue(withdrawTier)

  const selectedBankedItem =
    selectedBankedSlot?.kind === 'item' ? bankedGearItems.find((item) => item.id === selectedBankedSlot.id) : undefined
  const selectedBankedItemTemplate = selectedBankedItem && templates.find((t) => t.id === selectedBankedItem.template_id)
  const selectedBankedStoneTier = selectedBankedSlot?.kind === 'stone' ? selectedBankedSlot.tier : undefined
  const selectedBankedCurrencyType = selectedBankedSlot?.kind === 'currency' ? selectedBankedSlot.currencyType : undefined

  const bankedSlotKey = (slot: NonNullable<SelectedBankedSlot>): string =>
    slot.kind === 'item' ? `item:${slot.id}` : slot.kind === 'stone' ? `stone:${slot.tier}` : `currency:${slot.currencyType}`

  const toggleBankedSlot = (slot: NonNullable<SelectedBankedSlot>, anchorRect: DOMRect) => {
    setBankedActionError(null)
    setSelectedBankedSlot((current) => (current && bankedSlotKey(current) === bankedSlotKey(slot) ? null : slot))
    setBankedPopoverAnchorRect(anchorRect)
  }

  const closeBankedPopover = () => {
    setSelectedBankedSlot(null)
    setBankedPopoverAnchorRect(null)
  }

  const handleTileDrop = (overTarget: string | null, id: string) => {
    if (overTarget) {
      onTileDrop?.(overTarget, id)
    }
  }

  const selectEntry = (entryId: string) => {
    setWithdrawError(null)
    setWithdrawTier(0)
    setSelectedEntryId((current) => (current === entryId ? null : entryId))
  }

  // Withdraws every OLD token entry at the free Normal tier (confirmed with
  // the user, 2026-08-03) — matches the existing drag-out shortcut's own
  // default tier. Scoped to the legacy token list only — the new banked-gear
  // popover has its own "Withdraw All" (below), since the two are separate
  // mechanisms. Sequential, not Promise.all, so each withdrawal's
  // client-side Inventory-full pre-check sees the previous one's real effect.
  const handleWithdrawAll = async () => {
    setWithdrawAllError(null)
    setWithdrawAllBusy(true)
    let failures = 0
    let stoppedForFullInventory = false

    for (const entry of tokenItems) {
      const result = await withdrawItem(characterId, entry.template_id, 0)
      if (!result.ok) {
        failures += 1
        if (result.error === 'inventory_full') {
          stoppedForFullInventory = true
          break
        }
      }
    }

    setWithdrawAllBusy(false)
    if (stoppedForFullInventory) {
      setWithdrawAllError('Inventory filled up — stopped there.')
    } else if (failures > 0) {
      setWithdrawAllError(`Couldn't withdraw ${failures} item${failures === 1 ? '' : 's'}.`)
    }
  }

  const handleWithdrawBankedItem = async (itemId: string) => {
    setBankedActionError(null)
    setBankedActionBusy(true)
    const result = await withdrawItemFromStorage(itemId)
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

    for (const item of bankedGearItems) {
      const result = await withdrawItemFromStorage(item.id)
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

  const handleWithdrawBankedStone = async (tier: number) => {
    setBankedActionError(null)
    setBankedActionBusy(true)
    const result = await withdrawStoneItem(characterId, tier, 1)
    setBankedActionBusy(false)

    if (!result.ok) {
      setBankedActionError("Couldn't withdraw that stone.")
      return
    }

    closeBankedPopover()
  }

  const handleWithdrawAllBankedStone = async (tier: number) => {
    const owned = stonesBanked[String(tier)] ?? 0
    if (owned <= 0) {
      return
    }
    setBankedActionError(null)
    setBankedActionBusy(true)
    const result = await withdrawStoneItem(characterId, tier, owned)
    setBankedActionBusy(false)

    if (!result.ok) {
      setBankedActionError("Couldn't withdraw those stones.")
      return
    }

    closeBankedPopover()
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Storage ({occupiedCount}/{WAREHOUSE_SLOT_CAP})
          </p>

          {(tokenItems.length > 0 || bankedActionError) && (
            <div className="flex items-center gap-2 text-xs">
              {withdrawAllError && <span className="text-amber-400">{withdrawAllError}</span>}
              {bankedActionError && <span className="text-amber-400">{bankedActionError}</span>}
              {tokenItems.length > 0 && (
                <button
                  type="button"
                  disabled={withdrawAllBusy}
                  onClick={() => void handleWithdrawAll()}
                  className="rounded border border-sky-500 bg-sky-500/10 px-2 py-1 font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {withdrawAllBusy ? 'Withdrawing…' : 'Withdraw All (free tier)'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Responsive tracks matching InventoryPanel's own fix (3.5rem below
            `lg`, unchanged 4rem at `lg`+). overflow-x-auto is the same
            defensive backstop. 5 columns (not 8) — matches Forge/Combat's own
            InventoryPanel `columns={5}` convention below it on this same page. */}
        <div data-drop-zone="warehouse-storage" className="mt-2 overflow-x-auto">
        <div className="grid grid-cols-[repeat(5,3.5rem)] gap-1.5 lg:grid-cols-[repeat(5,4rem)]">
          {/* NEW Bank-Storage gear tiles — real, identity-preserving items,
              non-stacking, no badge (no count to show — each is its own
              tile), same quality-tinted border/icon as an Inventory tile. */}
          {bankedGearItems.map((item) => {
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

          {/* NEW Bank-Storage stone tiles — one per unit, same non-stacking
              convention as Inventory's own stone tiles. */}
          {bankedStoneTiles.map(({ tier, index }) => (
            <div
              key={`banked-stone-${tier}-${index}`}
              data-tooltip-action-anchor
              onClick={(event) => toggleBankedSlot({ kind: 'stone', tier }, event.currentTarget.getBoundingClientRect())}
            >
              <InventorySlot
                slotId={`banked-stone-${tier}-${index}`}
                filled
                sizeClassName={SLOT_SIZE_CLASS}
                icon="🔷"
                qualityColor={MATERIAL_COLOR}
                label={`+${tier} Stone (Storage)`}
                selected={selectedBankedSlot?.kind === 'stone' && selectedBankedSlot.tier === tier}
              />
            </div>
          ))}

          {/* NEW Bank-Storage Meteor/DragonBall tiles — same idea. */}
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

          {/* OLD fungible per-template token — legacy, unused going forward
              (see this file's own top comment), rendered unchanged in case any
              ever exist. */}
          {tokenItems.map((entry) => {
            const template = templates.find((t) => t.id === entry.template_id)
            const label = template ? template.name : 'Unknown item'
            const tooltip: ItemTooltipData = {
              title: label,
              lines: [`x${entry.count} in Storage`, 'Choose a tier to withdraw at'],
            }
            const icon = getItemIcon(template?.slot_type)
            const iconSrc = getGearIconSrc(template?.name)

            const commonProps = {
              slotId: entry.id,
              filled: true as const,
              sizeClassName: SLOT_SIZE_CLASS,
              icon,
              iconSrc,
              label,
              tooltip,
              badge: `x${entry.count}`,
              selected: selectedEntryId === entry.id,
            }

            if (onTileDrop) {
              return (
                <DraggableInventorySlot
                  key={entry.id}
                  {...commonProps}
                  dragEnabled
                  dragPayload={{ id: entry.template_id, icon, iconSrc, badge: `x${entry.count}` }}
                  onDrop={handleTileDrop}
                  onClick={() => selectEntry(entry.id)}
                />
              )
            }

            return <InventorySlot key={entry.id} {...commonProps} onClick={() => selectEntry(entry.id)} />
          })}

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
      </div>

      {selectedEntry && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-700 bg-slate-800 text-lg">
              {getGearIconSrc(selectedTemplate?.name) ? (
                <img src={getGearIconSrc(selectedTemplate?.name)} alt="" className="h-3/5 w-3/5 object-contain" />
              ) : (
                getItemIcon(selectedTemplate?.slot_type)
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">{selectedTemplate ? selectedTemplate.name : 'Unknown item'}</p>
              <p className="text-xs text-slate-500">x{selectedEntry.count} in Storage</p>
            </div>
          </div>

          <div className="mt-3">
            <p className="text-xs text-slate-400">Withdraw at tier:</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setWithdrawTier(0)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                  withdrawTier === 0 ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                Normal (free)
              </button>
              {COMPOSITION_STONE_TIERS.map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setWithdrawTier(tier)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                    withdrawTier === tier
                      ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  +{tier} ({compositionPointValue(tier)} pts)
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={busy || points < withdrawCost}
            onClick={async () => {
              setWithdrawError(null)
              const result = await withdrawItem(characterId, selectedEntry.template_id, withdrawTier)
              if (!result.ok) {
                setWithdrawError(
                  result.error === 'inventory_full'
                    ? 'Inventory is full.'
                    : result.error === 'not_enough_points'
                      ? "You don't have enough Bank points."
                      : "Couldn't withdraw that item.",
                )
              }
            }}
            className="mt-3 w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Withdraw{withdrawCost > 0 ? ` (${withdrawCost} pts)` : ''}
          </button>

          {withdrawError && <p className="mt-2 text-xs text-amber-400">{withdrawError}</p>}
        </div>
      )}

      {selectedBankedItem && bankedPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={bankedPopoverAnchorRect}
          tooltip={buildGearTooltip(selectedBankedItem, selectedBankedItemTemplate)}
          actions={[
            {
              label: bankedActionBusy ? 'Withdrawing…' : 'Withdraw',
              onClick: () => void handleWithdrawBankedItem(selectedBankedItem.id),
              disabled: bankedActionBusy,
            },
            {
              label: 'Withdraw All',
              onClick: () => void handleWithdrawAllBankedItems(),
              disabled: bankedActionBusy,
            },
          ]}
          onClose={closeBankedPopover}
        />
      )}

      {selectedBankedStoneTier !== undefined && bankedPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={bankedPopoverAnchorRect}
          tooltip={buildStoneTooltip(selectedBankedStoneTier)}
          actions={[
            {
              label: bankedActionBusy ? 'Withdrawing…' : 'Withdraw',
              onClick: () => void handleWithdrawBankedStone(selectedBankedStoneTier),
              disabled: bankedActionBusy,
            },
            {
              label: 'Withdraw All',
              onClick: () => void handleWithdrawAllBankedStone(selectedBankedStoneTier),
              disabled: bankedActionBusy,
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
              disabled: bankedActionBusy,
            },
            {
              label: 'Withdraw All',
              onClick: () => void handleWithdrawAllBankedCurrency(selectedBankedCurrencyType),
              disabled: bankedActionBusy,
            },
          ]}
          onClose={closeBankedPopover}
        />
      )}
    </div>
  )
}
