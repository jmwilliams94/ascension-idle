import { useState } from 'react'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { LOOT_HOLDING_CAP, useLootHoldingStore } from '../game/items/useLootHoldingStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { formatItemDisplayName, getItemIcon, getQualityColor, previewSellPrice } from '../game/items/equipmentBonus'
import { DRAGONBALL_ICON_SRC, METEOR_ICON_SRC } from '../game/items/forgeCosts'

// Loot Holding (confirmed with the user, 2026-07-30): where a server-resolved
// kill's item drop lands when Inventory is full — see useLootHoldingStore and
// supabase/functions/resolve-combat.
// Moved out of the Warehouse tab entirely (2026-07-31, per the user's
// request) into an "idle rewards" interface only — it now lives exclusively
// inside OfflineProgressModal, surfaced right when a player returns from
// being away, rather than as a persistent Warehouse card. Live play no
// longer uses Loot Holding at all: a full Inventory during active combat now
// stops the fight outright instead (see useCombatStore.stopForInventoryFull/
// InventoryFullWarningHud) — "a full inventory should stop combat," per the
// user. Loot Holding's only remaining source is the offline/idle-progress
// simulator (supabase/functions/resolve-combat's 'offline' mode), which
// still overflows a drop here when the simulated window's Inventory fills
// up partway through.
// Redesigned (2026-07-31, per the user's request) from a line-by-line list
// into an inventory-slot-style grid — one InventorySlot tile per entry,
// matching how Inventory/Warehouse Storage/Forge all already render gear —
// rather than a bespoke row layout unique to this one card. Clicking a tile
// opens the same click-to-select detail card convention used everywhere else
// (Claim, plus Sell for gear entries — see below). Not a fixed 40/100-cell
// grid like Inventory/Warehouse Storage — only actually-held entries render,
// no empty filler tiles, since Loot Holding's whole point is "temporary
// overflow," not a persistent slotted container.
// Sell straight from here (confirmed with the user): a full Inventory
// shouldn't force claiming junk just to immediately sell it from there — a
// "Sell All Normal" shortcut sells every Normal-tier gear entry in one go
// (same one-button convenience as the Shop's own "Select All Normal"), and
// the per-entry detail card also offers a plain "Sell" button for any tier.
// Both go through the sell_loot_holding RPC (mirrors sell_item's price
// formula exactly), which deletes the holding row directly — no Inventory
// round-trip, no slot ever spent. Currency-type entries (Meteor/DragonBall)
// have nothing to sell (no template/price) and only ever show Claim.
//
// Checkbox multi-select + bulk bar (confirmed with the user, 2026-08-01) —
// mirrors InventoryPanel's Shop bulk-sell UI exactly (checkbox overlay with
// stopPropagation so checking a box doesn't also open the single-item detail
// card underneath it, a running total, a "Select All" shortcut). Added
// because a long idle/AFK session can leave dozens of entries here and
// clicking Claim/Sell one at a time doesn't hold up on a phone. "Select All
// Normal" (above) and the single-item detail card (below) both still work
// unchanged, entirely independent of this — this is strictly additive.
export default function LootHoldingCard() {
  const entries = useLootHoldingStore((state) => state.entries)
  const busy = useLootHoldingStore((state) => state.busy)
  const claim = useLootHoldingStore((state) => state.claim)
  const sell = useLootHoldingStore((state) => state.sell)
  const templates = useItemTemplatesStore((state) => state.templates)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [claimAllBusy, setClaimAllBusy] = useState(false)
  const [claimAllError, setClaimAllError] = useState<string | null>(null)

  if (entries.length === 0) {
    return null
  }

  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null
  const selectedTemplate = selectedEntry?.template_id ? (templates.find((t) => t.id === selectedEntry.template_id) ?? null) : null

  const normalEntries = entries.filter((entry) => entry.template_id && entry.quality_tier === 'normal')
  const normalSellTotal = normalEntries.reduce((sum, entry) => {
    const template = templates.find((t) => t.id === entry.template_id)
    return sum + (template ? previewSellPrice(template.price, 'normal') : 0)
  }, 0)

  // Currency entries (Meteor/DragonBall) have no template/price — sellable
  // for the bulk total means "gear entry with a resolvable price," same test
  // the single-item detail card's own selectedSellPrice already uses below.
  const bulkSellableTotal = entries
    .filter((entry) => bulkSelected.has(entry.id) && entry.template_id && entry.quality_tier)
    .reduce((sum, entry) => {
      const template = templates.find((t) => t.id === entry.template_id)
      return sum + (template && entry.quality_tier ? previewSellPrice(template.price, entry.quality_tier) : 0)
    }, 0)

  const toggleBulkSelection = (id: string) => {
    setBulkSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSellAllNormal = async () => {
    setError(null)
    // Parallel, not sequential (2026-08-01, fixes a visible "sells one at a
    // time" delay) — each sell call is an independent row delete, same
    // reasoning as InventoryPanel's own bulk sell.
    await Promise.all(normalEntries.map((entry) => sell(entry.id)))
    setSelectedId(null)
  }

  // One-click claim of every entry, gear and currency alike — no selection
  // step needed (confirmed with the user, 2026-08-01), unlike the existing
  // "Select All" + "Move to Inventory" two-step flow below, which is kept for
  // when the player wants to claim only *some* entries and sell the rest.
  const handleClaimAll = async () => {
    setClaimAllError(null)
    setClaimAllBusy(true)
    const results = await Promise.all(entries.map((entry) => claim(entry.id)))
    const failures = results.filter((result) => !result.ok).length
    setClaimAllBusy(false)
    setSelectedId(null)
    if (failures > 0) {
      setClaimAllError(`Couldn't claim ${failures} item${failures === 1 ? '' : 's'} — make sure you have room.`)
    }
  }

  const handleClaim = async () => {
    if (!selectedEntry) {
      return
    }
    setError(null)
    const result = await claim(selectedEntry.id)
    if (result.ok) {
      setSelectedId(null)
    } else {
      setError("Couldn't claim that — make sure you have room.")
    }
  }

  const handleSell = async () => {
    if (!selectedEntry) {
      return
    }
    setError(null)
    const result = await sell(selectedEntry.id)
    if (result.ok) {
      setSelectedId(null)
    } else {
      setError("Couldn't sell that.")
    }
  }

  const handleBulkClaim = async () => {
    setBulkError(null)
    setBulkBusy(true)
    const results = await Promise.all(Array.from(bulkSelected).map((id) => claim(id)))
    const failures = results.filter((result) => !result.ok).length
    setBulkBusy(false)
    setBulkSelected(new Set())
    if (failures > 0) {
      setBulkError(`Couldn't move ${failures} item${failures === 1 ? '' : 's'} — make sure you have room.`)
    }
  }

  const handleBulkSell = async () => {
    setBulkError(null)
    setBulkBusy(true)
    const sellableIds = Array.from(bulkSelected).filter((id) => {
      const entry = entries.find((candidate) => candidate.id === id)
      return Boolean(entry?.template_id && entry.quality_tier)
    })
    const results = await Promise.all(sellableIds.map((id) => sell(id)))
    const failures = results.filter((result) => !result.ok).length
    setBulkBusy(false)
    setBulkSelected(new Set())
    if (failures > 0) {
      setBulkError(`Couldn't sell ${failures} item${failures === 1 ? '' : 's'}.`)
    }
  }

  const selectedIsCurrency = Boolean(selectedEntry?.currency_type)
  const selectedLabel = selectedEntry
    ? selectedIsCurrency
      ? selectedEntry.currency_type === 'meteor'
        ? 'Meteor'
        : 'DragonBall'
      : selectedTemplate && selectedEntry.quality_tier
        ? formatItemDisplayName(selectedTemplate.name, selectedEntry.quality_tier)
        : 'Unknown item'
    : ''
  const selectedSellPrice =
    selectedEntry && !selectedIsCurrency && selectedTemplate && selectedEntry.quality_tier
      ? previewSellPrice(selectedTemplate.price, selectedEntry.quality_tier)
      : null

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎁</span>
          <div>
            <p className="text-sm font-semibold text-slate-200">Loot Holding</p>
            <p className="text-[11px] text-slate-500">
              {entries.length}/{LOOT_HOLDING_CAP} pending
            </p>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        Drops that couldn't fit while you were away land here — claim them all at once, or sell gear straight from here instead.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={claimAllBusy}
          onClick={() => void handleClaimAll()}
          className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {claimAllBusy ? 'Claiming…' : `Claim All (${entries.length})`}
        </button>
        {normalEntries.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSellAllNormal()}
            className="rounded-lg border border-amber-600 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sell All Normal ({normalSellTotal.toLocaleString()} gold)
          </button>
        )}
        <button
          type="button"
          onClick={() => setBulkSelected(new Set(entries.map((entry) => entry.id)))}
          className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
        >
          Select individually…
        </button>
      </div>
      {claimAllError && <p className="text-[11px] text-amber-400">{claimAllError}</p>}

      <div className="overflow-x-auto">
        <div className="grid grid-cols-[repeat(8,3.5rem)] gap-1.5 lg:grid-cols-[repeat(8,4rem)]">
          {entries.map((entry) => {
            const isCurrency = Boolean(entry.currency_type)
            const template = entry.template_id ? templates.find((t) => t.id === entry.template_id) : null
            const label = isCurrency
              ? entry.currency_type === 'meteor'
                ? 'Meteor'
                : 'DragonBall'
              : template && entry.quality_tier
                ? formatItemDisplayName(template.name, entry.quality_tier)
                : 'Unknown item'
            const icon = isCurrency ? undefined : getItemIcon(template?.slot_type)
            const iconSrc = isCurrency ? (entry.currency_type === 'meteor' ? METEOR_ICON_SRC : DRAGONBALL_ICON_SRC) : undefined

            const slot = (
              <InventorySlot
                key={entry.id}
                slotId={entry.id}
                filled
                sizeClassName={SLOT_SIZE_CLASS}
                icon={icon}
                iconSrc={iconSrc}
                label={label}
                qualityColor={!isCurrency ? getQualityColor(entry.quality_tier ?? 'normal') : undefined}
                selected={selectedId === entry.id}
                onClick={() => {
                  setSelectedId((current) => (current === entry.id ? null : entry.id))
                  setError(null)
                }}
              />
            )

            // Checkbox overlay, not a change to InventorySlot itself — same
            // pattern as InventoryPanel's Shop bulk-sell checkbox.
            // stopPropagation keeps checking a box from also opening this
            // tile's single-item detail card underneath it.
            return (
              <div key={entry.id} className="relative">
                {slot}
                <input
                  type="checkbox"
                  checked={bulkSelected.has(entry.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => toggleBulkSelection(entry.id)}
                  className="absolute left-1 top-1 h-3.5 w-3.5 cursor-pointer accent-sky-500"
                  aria-label={`Select ${label}`}
                />
              </div>
            )
          })}
        </div>
      </div>

      {bulkSelected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs">
          <span className="text-slate-300">{bulkSelected.size} selected</span>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void handleBulkClaim()}
            className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bulkBusy ? 'Working…' : 'Move to Inventory'}
          </button>
          <button
            type="button"
            disabled={bulkBusy || bulkSellableTotal === 0}
            onClick={() => void handleBulkSell()}
            className="rounded-lg border border-amber-600 bg-amber-500/10 px-3 py-1 font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sell Selected ({bulkSellableTotal.toLocaleString()} gold)
          </button>
          <button
            type="button"
            onClick={() => setBulkSelected(new Set())}
            className="text-slate-500 underline hover:text-slate-300"
          >
            Clear
          </button>
          {bulkError && <span className="w-full text-amber-400">{bulkError}</span>}
        </div>
      )}

      {selectedEntry && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-sm font-medium text-slate-200">{selectedLabel}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleClaim()}
              className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Claim
            </button>
            {selectedSellPrice !== null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSell()}
                className="rounded-lg border border-amber-600 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sell ({selectedSellPrice.toLocaleString()} gold)
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-xs text-amber-400">{error}</p>}
        </div>
      )}
    </div>
  )
}
