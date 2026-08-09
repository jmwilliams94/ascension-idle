import { useState } from 'react'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import TooltipActionPopover from './TooltipActionPopover'
import { LOOT_HOLDING_CAP, useLootHoldingStore, type LootHoldingEntry } from '../game/items/useLootHoldingStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useInventoryStore, occupiedSlotCount, INVENTORY_SLOT_CAP } from '../game/items/useInventoryStore'
import { useBankStore, BANK_SLOT_CAP } from '../game/items/useBankStore'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import {
  buildGearTooltip,
  formatItemDisplayName,
  getGearIconSrc,
  getItemIcon,
  getQualityColor,
  previewSellPrice,
} from '../game/items/equipmentBonus'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'
import {
  FALLEN_STAR_COLOR,
  FALLEN_STAR_ICON_SRC,
  MATERIAL_COLOR,
  COMET_ICON_SRC,
  buildCometTooltip,
  buildFallenStarTooltip,
} from '../game/items/forgeCosts'

// Loot Holding (confirmed with the user, 2026-07-30): where a server-resolved
// kill's item drop lands when Inventory is full — see useLootHoldingStore and
// supabase/functions/resolve-combat. Lives exclusively inside
// OfflineProgressModal (2026-07-31) — Loot Holding's only remaining source is
// the offline/idle-progress simulator; live play stops the fight outright on
// a full Inventory instead (see useCombatStore.stopForInventoryFull).
//
// Staged redesign (2026-08-07), confirmed with the user, replaces every
// earlier version of this card (the click-to-open Sell/Bank popovers, the
// "Clear Everything" liquidate-all fallback — both superseded, not
// additive). Originally 3 stages that hid Normal-tier gear behind a single
// "Sell All Normal" button with no tiles shown at all — justified back then
// by how spammy Normal drops were. Reworked 2026-08-10 (confirmed with the
// user, after the quality-drop-rate recalibration made ANY drop meaningfully
// rarer): that hid-behind-a-button treatment no longer made sense, so Normal
// gear now gets the same individual-tile-plus-popover treatment quality gear
// already had — the "Sell All Normal" button survives only as an optional
// bulk-convenience shortcut above the grid, not a gate. Two stages now,
// derived purely from what's still in `entries` (no separate step/wizard
// state to desync):
//   1. 'currency' — Comet/Fallen Star entries present: shown as a small tile
//      grid with two bulk actions, "Claim All" and "Store All."
//   2. 'gear' — once currency is cleared: every remaining gear entry
//      (Normal and quality alike) shown as an individual tile. Tapping one
//      opens the same 3-action popover — Claim / Store / Sell — regardless
//      of tier. A "Claim All" button (2026-08-13) sits above the grid,
//      always available; a "Sell All Normal" button also appears whenever
//      at least one Normal-tier item is present, for fast bulk clearing
//      without needing to tap each one.
//
// Both "Claim All" buttons (2026-08-13) only ever claim as many entries as
// currently fit in Inventory, then stop — see claimEntriesUpToRoom's own
// comment for why this has to claim sequentially rather than all at once.
// "Store" (new, 2026-08-07) is the actual fix for the previously-reported
// dead end: it inserts straight into account-wide Bank Storage
// (store_loot_holding_to_bank for gear, the pre-existing bank_loot_holding
// for currency), bypassing Inventory's 40-slot cap entirely — unlike Claim,
// it can only ever fail if Storage's OWN 40-slot cap (BANK_SLOT_CAP) is
// full, a much rarer edge. Claim/Store both turn red (TooltipActionPopover's
// new `tone: 'warning'`, or an inline equivalent for the stage-2 bulk
// button) when their destination is already full, so the reason is visible
// without a failed click.

// Synthetic ItemInstance for buildGearTooltip/previewSellPrice, mirroring
// ShopPanel.tsx's own previewInstance — a Loot Holding entry isn't a real
// item_instances row yet (it only stores template_id/quality_tier/
// composition_level, not level/sockets — those get set fresh at claim/store
// time, see CLAUDE.md's Level Upgrade note on claim_loot_holding), so this
// fills in the same "no sockets" defaults Shop's own preview already
// established for a not-yet-owned item, just using the entry's own real
// quality_tier/composition_level instead of always Normal/+0.
function previewInstanceForEntry(entry: LootHoldingEntry, template: ItemTemplate): ItemInstance {
  return {
    id: entry.id,
    template_id: template.id,
    owner_id: '',
    quality_tier: entry.quality_tier ?? 'normal',
    level: template.required_level,
    composition_level: entry.composition_level,
    composition_points: 0,
    sockets: [],
    enchant: null,
    created_at: entry.created_at,
    location: 'inventory',
  }
}

export default function LootHoldingCard() {
  const entries = useLootHoldingStore((state) => state.entries)
  const busy = useLootHoldingStore((state) => state.busy)
  const claim = useLootHoldingStore((state) => state.claim)
  const sell = useLootHoldingStore((state) => state.sell)
  const bank = useLootHoldingStore((state) => state.bank)
  const storeGear = useLootHoldingStore((state) => state.storeGear)
  const templates = useItemTemplatesStore((state) => state.templates)

  // Reactive, raw-field selections (not the non-reactive occupiedSlotCount()
  // store method) so the red/disabled "full" state actually updates live —
  // see this project's own zustand-selector-pitfall note on why a bound
  // method call inside a selector doesn't trigger re-renders on its own.
  const inventoryItems = useInventoryStore((state) => state.items)
  const inventoryFull = occupiedSlotCount(inventoryItems) >= INVENTORY_SLOT_CAP
  const bankedItemCount = useBankStore((state) => state.bankedItems.length)
  const cometBankCount = usePlayerRecordStore((state) => state.cometBankCount)
  const fallenStarBankCount = usePlayerRecordStore((state) => state.fallenStarBankCount)
  const storageFull = bankedItemCount + cometBankCount + fallenStarBankCount >= BANK_SLOT_CAP

  const [error, setError] = useState<string | null>(null)
  const [popoverEntryId, setPopoverEntryId] = useState<string | null>(null)
  const [popoverAnchorRect, setPopoverAnchorRect] = useState<DOMRect | null>(null)
  // Local guard for a whole Claim All batch (below) — the store's own `busy`
  // flag toggles true/false around each individual claim() call, so between
  // sequential awaits there's a real gap where it reads false again. Without
  // this, a second click mid-batch could start an overlapping batch.
  const [bulkBusy, setBulkBusy] = useState(false)

  if (entries.length === 0) {
    return null
  }

  const normalGearEntries = entries.filter(
    (entry) => entry.template_id && entry.quality_tier === 'normal' && entry.composition_level === 0
  )
  const currencyEntries = entries.filter((entry) => entry.currency_type)
  const gearEntries = entries.filter((entry) => entry.template_id)

  const normalSellTotal = normalGearEntries.reduce((sum, entry) => {
    const template = templates.find((t) => t.id === entry.template_id)
    return sum + (template ? previewSellPrice(template.price, 'normal') : 0)
  }, 0)

  const stage: 'currency' | 'gear' = currencyEntries.length > 0 ? 'currency' : 'gear'

  const handleSellAllNormal = async () => {
    setError(null)
    const results = await Promise.all(normalGearEntries.map((entry) => sell(entry.id)))
    const failures = results.filter((result) => !result.ok).length
    if (failures > 0) {
      setError(`Couldn't sell ${failures} item${failures === 1 ? '' : 's'}.`)
    }
  }

  // Claims entries one at a time (not Promise.all) so each claim's real
  // effect on Inventory room is visible to the next iteration's check before
  // it fires — claim() itself only pre-checks room synchronously against
  // whatever's in the store *right now*, so firing every request at once
  // would let them all pass that check simultaneously (before any of the
  // earlier ones have actually landed and updated the store), letting the
  // batch claim more items than actually fit. Stops the moment a claim
  // reports the Inventory is full, leaving the rest in Loot Holding for
  // later — "only claim what currently fits," not "claim everything or
  // nothing."
  const claimEntriesUpToRoom = async (candidates: LootHoldingEntry[]) => {
    let claimedCount = 0
    for (const entry of candidates) {
      if (occupiedSlotCount(useInventoryStore.getState().items) >= INVENTORY_SLOT_CAP) {
        break
      }
      const result = await claim(entry.id)
      if (result.ok) {
        claimedCount += 1
      } else if (result.error === 'inventory_full') {
        break
      }
      // Any other failure (stale/already-claimed entry) — skip it and keep
      // going rather than aborting the whole batch.
    }
    return { claimedCount, totalCandidates: candidates.length }
  }

  const handleClaimAllCurrency = async () => {
    setError(null)
    setBulkBusy(true)
    const { claimedCount, totalCandidates } = await claimEntriesUpToRoom(currencyEntries)
    setBulkBusy(false)
    if (claimedCount < totalCandidates) {
      setError(
        claimedCount === 0
          ? "Inventory is full — try Store instead, or free up Inventory space."
          : `Claimed ${claimedCount} of ${totalCandidates} — Inventory is now full. Try Store for the rest, or free up space.`,
      )
    }
  }

  const handleClaimAllGear = async () => {
    setError(null)
    setBulkBusy(true)
    const { claimedCount, totalCandidates } = await claimEntriesUpToRoom(gearEntries)
    setBulkBusy(false)
    if (claimedCount < totalCandidates) {
      setError(
        claimedCount === 0
          ? "Inventory is full — try Store or Sell instead, or free up Inventory space."
          : `Claimed ${claimedCount} of ${totalCandidates} — Inventory is now full. Try Store or Sell for the rest, or free up space.`,
      )
    }
  }

  const handleStoreAllCurrency = async () => {
    setError(null)
    const results = await Promise.all(currencyEntries.map((entry) => bank(entry.id)))
    const failures = results.filter((result) => !result.ok).length
    if (failures > 0) {
      setError(`Couldn't store ${failures}.`)
    }
  }

  const closePopover = () => {
    setPopoverEntryId(null)
    setPopoverAnchorRect(null)
  }

  const handleClaimOne = async (entryId: string) => {
    setError(null)
    const result = await claim(entryId)
    if (!result.ok) {
      setError(result.error === 'inventory_full' ? 'Inventory is full.' : "Couldn't claim that item.")
      return
    }
    closePopover()
  }

  const handleStoreOne = async (entryId: string) => {
    setError(null)
    const result = await storeGear(entryId)
    if (!result.ok) {
      setError(result.error === 'storage_full' ? 'Storage is full.' : "Couldn't store that item.")
      return
    }
    closePopover()
  }

  const handleSellOne = async (entryId: string) => {
    setError(null)
    const result = await sell(entryId)
    if (!result.ok) {
      setError("Couldn't sell that item.")
      return
    }
    closePopover()
  }

  const popoverEntry = popoverEntryId ? entries.find((entry) => entry.id === popoverEntryId) : undefined
  const popoverTemplate = popoverEntry?.template_id ? templates.find((t) => t.id === popoverEntry.template_id) : undefined
  const popoverSellPrice =
    popoverEntry && popoverTemplate ? previewSellPrice(popoverTemplate.price, popoverEntry.quality_tier ?? 'normal') : 0

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">🎁</span>
        <div>
          <p className="text-sm font-semibold text-slate-200">Loot Holding</p>
          <p className="text-[11px] text-slate-500">
            {entries.length}/{LOOT_HOLDING_CAP} pending
          </p>
        </div>
      </div>

      {stage === 'currency' && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500">Comets and Fallen Stars found while you were away.</p>
          <div className="flex justify-center overflow-x-auto">
            <div className="grid grid-cols-[repeat(5,3.5rem)] gap-1.5 lg:grid-cols-[repeat(5,4rem)]">
              {currencyEntries.map((entry) => (
                <InventorySlot
                  key={entry.id}
                  slotId={entry.id}
                  filled
                  sizeClassName={SLOT_SIZE_CLASS}
                  iconSrc={entry.currency_type === 'comet' ? COMET_ICON_SRC : FALLEN_STAR_ICON_SRC}
                  label={entry.currency_type === 'comet' ? 'Comet' : 'Fallen Star'}
                  tooltip={entry.currency_type === 'comet' ? buildCometTooltip() : buildFallenStarTooltip()}
                  qualityColor={entry.currency_type === 'comet' ? MATERIAL_COLOR : FALLEN_STAR_COLOR}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || bulkBusy || inventoryFull}
              title={inventoryFull ? 'Inventory is full' : undefined}
              onClick={() => void handleClaimAllCurrency()}
              className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed ${
                inventoryFull
                  ? 'border-red-600 bg-red-500/10 text-red-400 disabled:opacity-70'
                  : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-50'
              }`}
            >
              {bulkBusy ? 'Claiming…' : 'Claim All'}
            </button>
            <button
              type="button"
              disabled={busy || bulkBusy}
              onClick={() => void handleStoreAllCurrency()}
              className="flex-1 rounded-lg border border-emerald-500 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Store All
            </button>
          </div>
        </div>
      )}

      {stage === 'gear' && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500">Tap an item below to Claim, Store, or Sell it.</p>
          <button
            type="button"
            disabled={busy || bulkBusy || inventoryFull}
            title={inventoryFull ? 'Inventory is full' : 'Claims as many items below as currently fit in your Inventory'}
            onClick={() => void handleClaimAllGear()}
            className={`w-full rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed ${
              inventoryFull
                ? 'border-red-600 bg-red-500/10 text-red-400 disabled:opacity-70'
                : 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-50'
            }`}
          >
            {bulkBusy ? 'Claiming…' : 'Claim All'}
          </button>
          {normalGearEntries.length > 0 && (
            <button
              type="button"
              disabled={busy || bulkBusy}
              onClick={() => void handleSellAllNormal()}
              className="w-full rounded-lg border border-amber-600 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Selling…' : `Sell All Normal (${normalSellTotal.toLocaleString()} gold)`}
            </button>
          )}
          <div className="flex justify-center overflow-x-auto">
            <div className="grid grid-cols-[repeat(5,3.5rem)] gap-1.5 lg:grid-cols-[repeat(5,4rem)]">
              {gearEntries.map((entry) => {
                const template = entry.template_id ? templates.find((t) => t.id === entry.template_id) : null
                const label = template && entry.quality_tier ? formatItemDisplayName(template.name, entry.quality_tier) : 'Unknown item'
                const icon = getItemIcon(template?.slot_type)
                const iconSrc = getGearIconSrc(template?.name)
                const isPopoverOpenForThisEntry = popoverEntryId === entry.id

                const slot = (
                  <InventorySlot
                    key={entry.id}
                    slotId={entry.id}
                    filled
                    sizeClassName={SLOT_SIZE_CLASS}
                    icon={icon}
                    iconSrc={iconSrc}
                    compositionLevel={entry.composition_level}
                    label={label}
                    selected={isPopoverOpenForThisEntry}
                    tooltip={
                      isPopoverOpenForThisEntry || !template
                        ? undefined
                        : buildGearTooltip(previewInstanceForEntry(entry, template), template)
                    }
                    onClick={template ? () => setPopoverEntryId(entry.id) : undefined}
                    qualityColor={getQualityColor(entry.quality_tier ?? 'normal')}
                  />
                )

                if (!template) {
                  return slot
                }

                return (
                  <div
                    key={entry.id}
                    data-tooltip-action-anchor
                    onClick={(event) => setPopoverAnchorRect(event.currentTarget.getBoundingClientRect())}
                  >
                    {slot}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-amber-400">{error}</p>}

      {popoverEntry && popoverTemplate && popoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={popoverAnchorRect}
          tooltip={buildGearTooltip(previewInstanceForEntry(popoverEntry, popoverTemplate), popoverTemplate)}
          actions={[
            {
              label: inventoryFull ? 'Claim (full)' : busy ? 'Claiming…' : 'Claim',
              onClick: () => void handleClaimOne(popoverEntry.id),
              disabled: busy || inventoryFull,
              tone: inventoryFull ? 'warning' : 'default',
            },
            {
              label: storageFull ? 'Store (full)' : busy ? 'Storing…' : 'Store',
              onClick: () => void handleStoreOne(popoverEntry.id),
              disabled: busy || storageFull,
              tone: storageFull ? 'warning' : 'default',
            },
            {
              label: busy ? 'Selling…' : `Sell (${popoverSellPrice.toLocaleString()}g)`,
              onClick: () => void handleSellOne(popoverEntry.id),
              disabled: busy,
            },
          ]}
          onClose={closePopover}
        />
      )}
    </div>
  )
}
