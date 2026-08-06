import { useState } from 'react'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import TooltipActionPopover from './TooltipActionPopover'
import { LOOT_HOLDING_CAP, useLootHoldingStore, type LootHoldingEntry } from '../game/items/useLootHoldingStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
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
// Simplified (2026-08-03, per the user's request), then reopened (2026-08-05,
// see the per-item Sell popover below): this card used to have its own
// click-to-select detail card, a checkbox multi-select + bulk action bar, a
// "Claim All" button, and a "Select individually…" toggle. Most of that is
// still gone — Claiming everything that's left is still the modal's own
// "Claim" button (see OfflineProgressModal.tsx), and there's still no
// checkbox multi-select — but the grid is interactive again for one specific
// action: gear tiles are clickable, opening a small Sell popover (any
// quality tier, not just Normal). Triggered by the user directly asking for
// this ("I need it to prompt first with hey welcome back... items obtained
// during the idle... can be sold on that pop up") after finding "Sell All
// Normal" alone wasn't enough — a non-Normal item had no sell path at all
// from here, which meant it always had to be claimed (needing Inventory
// room) or left to resurface later.
//
// Currency tiles (Comet/Fallen Star) gained the mirror-image Bank popover
// the same day (2026-08-05), reported by the user as a real dead end: "I
// just got to one of the claim screens and I couldn't claim my comets cause
// of a full inventory. Since I couldn't claim I couldn't get passed that
// screen." A claimed Comet/Fallen Star becomes its own non-stacking
// Inventory tile (see CLAUDE.md's Loot section), so claiming one needs a
// free slot exactly like gear does — and unlike gear, there was no sell
// path for currency at all (sell_loot_holding rejects it server-side), so a
// genuinely full Inventory left no way off this screen whatsoever, since
// OfflineProgressModal deliberately stays open on any claim failure rather
// than silently closing (see that file's own note). Banking routes the
// entry straight into the account-wide swap-model Bank instead
// (bank_loot_holding — see useLootHoldingStore.ts), which never touches
// Inventory at all.
//
// Grid width bug fix (2026-08-03): this was hardcoded to 8 columns, wider
// than a phone viewport even at the smaller mobile tile size — the same
// overflow bug already fixed elsewhere (InventoryPanel, BankGrid,
// Forge/Bank's own InventoryPanel usages), just never caught here since it
// only ever renders inside this one modal. Now 5, matching that established
// convention, and centered like every other grid that got the same fix.

// Synthetic ItemInstance for buildGearTooltip/previewSellPrice, mirroring
// ShopPanel.tsx's own previewInstance — a Loot Holding entry isn't a real
// item_instances row yet (it only stores template_id/quality_tier, not
// level/composition/sockets — those get set fresh at claim time, see
// CLAUDE.md's Level Upgrade note on claim_loot_holding), so this fills in
// the same "Normal-equivalent, no composition/sockets" defaults Shop's own
// preview already established for a not-yet-owned item, just using the
// entry's own real quality_tier instead of always 'normal'.
function previewInstanceForEntry(entry: LootHoldingEntry, template: ItemTemplate): ItemInstance {
  return {
    id: entry.id,
    template_id: template.id,
    owner_id: '',
    quality_tier: entry.quality_tier ?? 'normal',
    level: template.required_level,
    composition_level: 0,
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
  const sell = useLootHoldingStore((state) => state.sell)
  const bank = useLootHoldingStore((state) => state.bank)
  const liquidateAll = useLootHoldingStore((state) => state.liquidateAll)
  const templates = useItemTemplatesStore((state) => state.templates)

  const [error, setError] = useState<string | null>(null)
  const [sellPopoverEntryId, setSellPopoverEntryId] = useState<string | null>(null)
  const [sellPopoverAnchorRect, setSellPopoverAnchorRect] = useState<DOMRect | null>(null)
  const [bankPopoverEntryId, setBankPopoverEntryId] = useState<string | null>(null)
  const [bankPopoverAnchorRect, setBankPopoverAnchorRect] = useState<DOMRect | null>(null)
  // Confirm-gated (2026-08-07) — this can sell valuable non-Normal gear
  // indiscriminately, unlike the tier-scoped "Sell All Normal" shortcut, so
  // it needs an explicit second tap rather than firing on the first click.
  const [confirmingLiquidate, setConfirmingLiquidate] = useState(false)

  if (entries.length === 0) {
    return null
  }

  const normalEntries = entries.filter((entry) => entry.template_id && entry.quality_tier === 'normal')
  const normalSellTotal = normalEntries.reduce((sum, entry) => {
    const template = templates.find((t) => t.id === entry.template_id)
    return sum + (template ? previewSellPrice(template.price, 'normal') : 0)
  }, 0)
  const currencyEntries = entries.filter((entry) => entry.currency_type)

  const handleSellAllNormal = async () => {
    setError(null)
    // Parallel, not sequential (2026-08-01, fixes a visible "sells one at a
    // time" delay) — each sell call is an independent row delete, same
    // reasoning as InventoryPanel's own bulk sell.
    const results = await Promise.all(normalEntries.map((entry) => sell(entry.id)))
    const failures = results.filter((result) => !result.ok).length
    if (failures > 0) {
      setError(`Couldn't sell ${failures} item${failures === 1 ? '' : 's'}.`)
    }
  }

  // Bulk unblock for the reported stuck scenario — one click clears every
  // Comet/Fallen Star at once, regardless of type, rather than needing one
  // tap per entry via the popover below.
  const handleBankAllCurrency = async () => {
    setError(null)
    const results = await Promise.all(currencyEntries.map((entry) => bank(entry.id)))
    const failures = results.filter((result) => !result.ok).length
    if (failures > 0) {
      setError(`Couldn't bank ${failures} item${failures === 1 ? '' : 's'}.`)
    }
  }

  // Guaranteed escape hatch (2026-08-07, reported by the user: a single
  // leftover non-Normal item with a full Inventory left them with no
  // obvious way forward — Claim always needs Inventory room, and the only
  // sell path for a non-Normal item was clicking its own tile, easy to miss
  // once it's the last thing on screen). Always available, not conditioned
  // on a failed Claim — sells every gear entry (any tier) and banks every
  // currency entry currently present, in one confirmed action.
  const handleLiquidateAll = async () => {
    setError(null)
    setConfirmingLiquidate(false)
    const result = await liquidateAll()
    if (!result.ok) {
      setError(`Couldn't clear ${result.failures} item${result.failures === 1 ? '' : 's'}.`)
    }
  }

  const closeSellPopover = () => {
    setSellPopoverEntryId(null)
    setSellPopoverAnchorRect(null)
  }

  const closeBankPopover = () => {
    setBankPopoverEntryId(null)
    setBankPopoverAnchorRect(null)
  }

  const handleSellOne = async (entryId: string) => {
    setError(null)
    const result = await sell(entryId)
    if (!result.ok) {
      setError("Couldn't sell that item.")
      return
    }
    closeSellPopover()
  }

  const handleBankOne = async (entryId: string) => {
    setError(null)
    const result = await bank(entryId)
    if (!result.ok) {
      setError("Couldn't bank that item.")
      return
    }
    closeBankPopover()
  }

  const sellPopoverEntry = sellPopoverEntryId ? entries.find((entry) => entry.id === sellPopoverEntryId) : undefined
  const sellPopoverTemplate = sellPopoverEntry?.template_id
    ? templates.find((t) => t.id === sellPopoverEntry.template_id)
    : undefined
  const sellPopoverPrice =
    sellPopoverEntry && sellPopoverTemplate
      ? previewSellPrice(sellPopoverTemplate.price, sellPopoverEntry.quality_tier ?? 'normal')
      : 0
  const bankPopoverEntry = bankPopoverEntryId ? entries.find((entry) => entry.id === bankPopoverEntryId) : undefined

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
        Drops that couldn't fit while you were away land here — tap an item to sell or bank it, or use the buttons below, then
        Claim to bring the rest into your Inventory.
      </p>

      <div className="flex flex-wrap items-center gap-2">
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
        {currencyEntries.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleBankAllCurrency()}
            title="Sends every Comet/Fallen Star here straight to your account-wide Bank — doesn't need Inventory room."
            className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Bank All Comets/Fallen Stars ({currencyEntries.length})
          </button>
        )}
        {!confirmingLiquidate && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmingLiquidate(true)}
            title="Sells every gear item here (any quality tier) and banks every Comet/Fallen Star — use this if you're stuck with nowhere for something to go."
            className="rounded-lg border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear Everything ({entries.length})
          </button>
        )}
      </div>

      {confirmingLiquidate && (
        <div className="rounded-lg border border-amber-600 bg-amber-500/10 p-2.5">
          <p className="text-[11px] text-amber-300">
            This sells every gear item here — including anything above Normal quality — and banks every Comet/Fallen Star. Are you sure?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleLiquidateAll()}
              className="flex-1 rounded-lg border border-amber-500 bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Clearing…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingLiquidate(false)}
              className="flex-1 rounded-lg border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:border-slate-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-amber-400">{error}</p>}

      <div className="flex justify-center overflow-x-auto">
        <div className="grid grid-cols-[repeat(5,3.5rem)] gap-1.5 lg:grid-cols-[repeat(5,4rem)]">
          {entries.map((entry) => {
            const isCurrency = Boolean(entry.currency_type)
            const template = entry.template_id ? templates.find((t) => t.id === entry.template_id) : null
            const label = isCurrency
              ? entry.currency_type === 'comet'
                ? 'Comet'
                : 'Fallen Star'
              : template && entry.quality_tier
                ? formatItemDisplayName(template.name, entry.quality_tier)
                : 'Unknown item'
            const icon = isCurrency ? undefined : getItemIcon(template?.slot_type)
            const iconSrc = isCurrency
              ? entry.currency_type === 'comet'
                ? COMET_ICON_SRC
                : FALLEN_STAR_ICON_SRC
              : getGearIconSrc(template?.name)

            // Hover/long-press peek is suppressed specifically while this
            // tile's own Sell/Bank popover is open (2026-08-05, reported by
            // the user: "I'm seeing normal tooltip and the press and hold
            // tooltips at the same time") — the popover already renders the
            // same tooltip content itself, so leaving the peek active too let
            // it visibly overlap the popover once opened. Same fix as
            // InventoryPanel's own isPopoverOpenForSelection.
            const isSellPopoverOpenForThisEntry = sellPopoverEntryId === entry.id
            const isBankPopoverOpenForThisEntry = bankPopoverEntryId === entry.id

            const slot = (
              <InventorySlot
                key={entry.id}
                slotId={entry.id}
                filled
                sizeClassName={SLOT_SIZE_CLASS}
                icon={icon}
                iconSrc={iconSrc}
                label={label}
                selected={isSellPopoverOpenForThisEntry || isBankPopoverOpenForThisEntry}
                tooltip={
                  isBankPopoverOpenForThisEntry || isSellPopoverOpenForThisEntry
                    ? undefined
                    : isCurrency
                      ? entry.currency_type === 'comet'
                        ? buildCometTooltip()
                        : buildFallenStarTooltip()
                      : template
                        ? buildGearTooltip(previewInstanceForEntry(entry, template), template)
                        : undefined
                }
                onClick={
                  isCurrency
                    ? () => {
                        // Mutually exclusive with the Sell popover — without
                        // clearing the other one's id here, clicking a gear
                        // tile then a currency tile (without dismissing the
                        // first) could leave both popovers rendered at once.
                        setSellPopoverEntryId(null)
                        setBankPopoverEntryId(entry.id)
                      }
                    : template
                      ? () => {
                          setBankPopoverEntryId(null)
                          setSellPopoverEntryId(entry.id)
                        }
                      : undefined
                }
                qualityColor={
                  isCurrency
                    ? entry.currency_type === 'comet'
                      ? MATERIAL_COLOR
                      : FALLEN_STAR_COLOR
                    : getQualityColor(entry.quality_tier ?? 'normal')
                }
              />
            )

            // Captures the tile's own bounding rect on click so
            // TooltipActionPopover can anchor to it, same
            // data-tooltip-action-anchor convention InventoryPanel's own
            // Bank/Bundle popovers already use — one anchor state for Sell
            // (gear), a separate one for Bank (currency), since a tile is
            // only ever one kind or the other.
            if (!template && !isCurrency) {
              return slot
            }

            return (
              <div
                key={entry.id}
                data-tooltip-action-anchor
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  if (isCurrency) {
                    setSellPopoverAnchorRect(null)
                    setBankPopoverAnchorRect(rect)
                  } else {
                    setBankPopoverAnchorRect(null)
                    setSellPopoverAnchorRect(rect)
                  }
                }}
              >
                {slot}
              </div>
            )
          })}
        </div>
      </div>

      {sellPopoverEntry && sellPopoverTemplate && sellPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={sellPopoverAnchorRect}
          tooltip={buildGearTooltip(previewInstanceForEntry(sellPopoverEntry, sellPopoverTemplate), sellPopoverTemplate)}
          actions={[
            {
              label: busy ? 'Selling…' : `Sell (${sellPopoverPrice.toLocaleString()}g)`,
              onClick: () => void handleSellOne(sellPopoverEntry.id),
              disabled: busy,
            },
          ]}
          onClose={closeSellPopover}
        />
      )}

      {bankPopoverEntry && bankPopoverAnchorRect && (
        <TooltipActionPopover
          anchorRect={bankPopoverAnchorRect}
          tooltip={bankPopoverEntry.currency_type === 'comet' ? buildCometTooltip() : buildFallenStarTooltip()}
          actions={[
            {
              label: busy ? 'Banking…' : 'Bank',
              onClick: () => void handleBankOne(bankPopoverEntry.id),
              disabled: busy,
            },
          ]}
          onClose={closeBankPopover}
        />
      )}
    </div>
  )
}
