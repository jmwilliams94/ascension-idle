import { useEffect, useState, type ReactNode } from 'react'
import InventoryPanel from './InventoryPanel'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import MarketplaceListingSlot, { type ListingDraftTarget } from './MarketplaceListingSlot'
import { DragDropProvider } from './dragDrop'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../game/items/useItemTemplatesStore'
import {
  useMarketplaceStore,
  type ListableCurrencyType,
  type ListingTarget,
  type MarketplaceListing,
  type ListingCurrency,
} from '../game/marketplace/useMarketplaceStore'
import { useMailStore, type MailEntry } from '../game/marketplace/useMailStore'
import { listableCurrencyLabel, listableCurrencyVisual } from '../game/marketplace/listableCurrency'
import { LISTING_DURATION_OPTIONS, previewListingFee } from '../game/marketplace/marketplaceCosts'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { buildGearTooltip, formatItemDisplayName, getGearIconSrc, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import { isDragonballDragId, isDragonballScrollDragId, isMeteorDragId, isMeteorScrollDragId } from '../game/items/forgeCosts'

// Marketplace (see CLAUDE.md's Gear system / Marketplace section) — three
// page-local sub-tabs, same "sub-navigation inside one top-level tab"
// convention ShopPanel's Weapons/Armor/Potions and ForgePanel's Quality/
// Level/Composition/Sockets already use. Browse and My Listings both mutate
// through useMarketplaceStore's RPC-wrapping actions; Mail through
// useMailStore's claim. Neither store is written to directly here.
type MarketTab = 'browse' | 'my-listings' | 'mail'

function currencyLabel(currency: ListingCurrency): string {
  return currency === 'gold' ? 'Gold' : 'Ascension Points'
}

function describeCreateError(error?: string): string {
  switch (error) {
    case 'invalid_currency':
    case 'invalid_price':
    case 'invalid_duration':
      return 'Check the price and duration.'
    case 'item_equipped':
      return 'Unequip that item first.'
    case 'already_listed':
      return "That item's already listed."
    case 'item_in_mail':
      return 'Claim that item from Mail first.'
    case 'not_enough_gold':
      return "You don't have enough Gold for the fee."
    case 'not_enough_ascension_points':
      return "You don't have enough Ascension Points for the fee."
    case 'not_enough_currency':
      return "You don't have one of those to list."
    case 'too_many_listings':
      return 'Your account already has 20 active listings — the max.'
    default:
      return 'Something went wrong.'
  }
}

function describeBuyError(error?: string): string {
  switch (error) {
    case 'own_listing':
      return "You can't buy your own listing."
    case 'not_active':
    case 'listing_expired':
      return 'That listing is no longer available.'
    case 'not_enough_gold':
      return "You don't have enough Gold."
    case 'not_enough_ascension_points':
      return "You don't have enough Ascension Points."
    default:
      return 'Something went wrong.'
  }
}

// A listing's own label — a real gear name, or one of the 4 listable
// currency type labels, or a placeholder for a since-claimed/unavailable
// gear item (see MarketplaceListing.item's own doc comment).
function listingLabel(listing: MarketplaceListing, templates: ItemTemplate[]): string {
  if (listing.currency_type) {
    return listableCurrencyLabel(listing.currency_type)
  }
  const template = listing.item ? templates.find((t) => t.id === listing.item!.template_id) : undefined
  return listing.item
    ? formatItemDisplayName(template?.name ?? 'Unknown item', listing.item.quality_tier, listing.item.composition_level)
    : 'Item unavailable'
}

function ListingTile({ listing, templates }: { listing: MarketplaceListing; templates: ItemTemplate[] }) {
  if (listing.currency_type) {
    const visual = listableCurrencyVisual(listing.currency_type)
    return (
      <InventorySlot
        slotId={listing.id}
        filled
        sizeClassName={SLOT_SIZE_CLASS}
        icon={visual.icon}
        iconSrc={visual.iconSrc}
        qualityColor={visual.qualityColor}
        label={listableCurrencyLabel(listing.currency_type)}
      />
    )
  }

  const template = listing.item ? templates.find((t) => t.id === listing.item!.template_id) : undefined
  const label = listingLabel(listing, templates)
  const icon = getItemIcon(template?.slot_type)
  const iconSrc = getGearIconSrc(template?.name)

  return (
    <InventorySlot
      slotId={listing.id}
      filled={Boolean(listing.item)}
      sizeClassName={SLOT_SIZE_CLASS}
      icon={listing.item ? icon : undefined}
      iconSrc={listing.item ? iconSrc : undefined}
      qualityColor={listing.item ? getQualityColor(listing.item.quality_tier) : undefined}
      label={label}
      tooltip={listing.item ? buildGearTooltip(listing.item, template) : undefined}
    />
  )
}

function ListingRow({ listing, templates, action }: { listing: MarketplaceListing; templates: ItemTemplate[]; action: ReactNode }) {
  const label = listingLabel(listing, templates)

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <ListingTile listing={listing} templates={templates} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-200">{label}</p>
        <p className="text-xs text-slate-500">
          {listing.price_amount.toLocaleString()} {currencyLabel(listing.price_currency)}
        </p>
        <p className="text-[11px] text-slate-600">
          {listing.status === 'active' ? `Expires ${new Date(listing.expires_at).toLocaleString()}` : `Status: ${listing.status}`}
        </p>
      </div>
      {action}
    </div>
  )
}

function BrowseTab({ characterId, templates }: { characterId: string; templates: ItemTemplate[] }) {
  const browseListings = useMarketplaceStore((state) => state.browseListings)
  const browseLoaded = useMarketplaceStore((state) => state.browseLoaded)
  const busy = useMarketplaceStore((state) => state.busy)
  const loadBrowseListings = useMarketplaceStore((state) => state.loadBrowseListings)
  const buyListing = useMarketplaceStore((state) => state.buyListing)

  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadBrowseListings()
    // Intentionally not re-run when browseListings itself changes — this only
    // needs to refetch when the tab mounts or the player explicitly refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleBuy = async (listingId: string) => {
    setError(null)
    const result = await buyListing(characterId, listingId)
    setConfirmingId(null)
    if (!result.ok) {
      setError(describeBuyError(result.error))
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{browseListings.length} listing{browseListings.length === 1 ? '' : 's'} for sale</p>
        <button
          type="button"
          onClick={() => void loadBrowseListings()}
          className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-xs text-amber-400">{error}</p>}

      {!browseLoaded ? (
        <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">Loading…</p>
      ) : browseListings.length === 0 ? (
        <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">Nothing for sale right now</p>
      ) : (
        <div className="max-h-[28rem] space-y-2 overflow-y-auto">
          {browseListings.map((listing) => (
            <ListingRow
              key={listing.id}
              listing={listing}
              templates={templates}
              action={
                listing.seller_character_id === characterId ? (
                  <span className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-500">Your listing</span>
                ) : confirmingId === listing.id ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleBuy(listing.id)}
                      className="rounded-lg border border-emerald-600 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? 'Working…' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      setConfirmingId(listing.id)
                    }}
                    className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
                  >
                    Buy
                  </button>
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

// What's staged in the drop slot before confirming — either a real gear
// item (by id, resolved live against the Inventory store so it stays in
// sync if that item changes) or one of the 4 listable currency types
// (2026-08-03). dragId is only needed to pass through as this tile's
// reservedItemIds entry, hiding it from the Inventory grid below while
// staged, the same way a staged gear item already is.
type ListingDraft = { kind: 'item'; itemId: string } | { kind: 'currency'; dragId: string; currencyType: ListableCurrencyType }

function ListAnItemForm({ characterId }: { characterId: string }) {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const gold = useProgressionStore((state) => state.gold)
  const ascensionPoints = usePlayerRecordStore((state) => state.ascensionPoints)
  const busy = useMarketplaceStore((state) => state.busy)
  const createListing = useMarketplaceStore((state) => state.createListing)

  const [draft, setDraft] = useState<ListingDraft | null>(null)
  const [priceCurrency, setPriceCurrency] = useState<ListingCurrency>('gold')
  const [priceAmount, setPriceAmount] = useState('')
  const [durationHours, setDurationHours] = useState(LISTING_DURATION_OPTIONS[2]?.hours ?? 24)
  const [error, setError] = useState<string | null>(null)

  const selectedItem = draft?.kind === 'item' ? (items.find((item) => item.id === draft.itemId) ?? null) : null
  const selectedTemplate = selectedItem ? (templates.find((t) => t.id === selectedItem.template_id) ?? null) : null
  const listingTarget: ListingDraftTarget | null =
    draft?.kind === 'item' && selectedItem
      ? { kind: 'item', item: selectedItem, template: selectedTemplate }
      : draft?.kind === 'currency'
        ? { kind: 'currency', currencyType: draft.currencyType }
        : null

  const parsedPrice = Number(priceAmount)
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice > 0
  const fee = priceValid ? previewListingFee(parsedPrice) : 0
  const balance = priceCurrency === 'gold' ? gold : ascensionPoints
  const canAffordFee = fee > 0 && balance >= fee

  const handleDropTarget = (dragId: string) => {
    if (isMeteorDragId(dragId)) {
      setDraft({ kind: 'currency', dragId, currencyType: 'meteor' })
      setError(null)
      return
    }
    if (isDragonballDragId(dragId)) {
      setDraft({ kind: 'currency', dragId, currencyType: 'dragonball' })
      setError(null)
      return
    }
    if (isMeteorScrollDragId(dragId)) {
      setDraft({ kind: 'currency', dragId, currencyType: 'meteor_scroll' })
      setError(null)
      return
    }
    if (isDragonballScrollDragId(dragId)) {
      setDraft({ kind: 'currency', dragId, currencyType: 'dragonball_scroll' })
      setError(null)
      return
    }
    if (items.some((item) => item.id === dragId)) {
      setDraft({ kind: 'item', itemId: dragId })
      setError(null)
    }
  }

  const handleTileDrop = (overTarget: string, id: string) => {
    if (overTarget === 'marketplace-listing') {
      handleDropTarget(id)
    }
  }

  const handleList = async () => {
    if (!draft || !priceValid) {
      return
    }
    setError(null)
    const target: ListingTarget =
      draft.kind === 'item' ? { kind: 'item', itemId: draft.itemId } : { kind: 'currency', currencyType: draft.currencyType }
    const result = await createListing(characterId, target, priceCurrency, Math.round(parsedPrice), durationHours)
    if (result.ok) {
      setDraft(null)
      setPriceAmount('')
    } else {
      setError(describeCreateError(result.error))
    }
  }

  return (
    <DragDropProvider>
      <div className="space-y-3 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-4">
        <p className="text-sm font-semibold text-slate-200">List an Item</p>

        <div className="flex flex-col items-start gap-4 sm:flex-row">
          <MarketplaceListingSlot target={listingTarget} onRemove={() => setDraft(null)} />

          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPriceCurrency('gold')}
                className={`rounded-lg border px-3 py-1 text-xs font-medium ${
                  priceCurrency === 'gold' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                Gold
              </button>
              <button
                type="button"
                onClick={() => setPriceCurrency('ascension_points')}
                className={`rounded-lg border px-3 py-1 text-xs font-medium ${
                  priceCurrency === 'ascension_points'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                    : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                Ascension Points
              </button>
            </div>

            <input
              type="number"
              min={1}
              value={priceAmount}
              onChange={(event) => setPriceAmount(event.target.value)}
              placeholder="Price"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />

            <div className="flex flex-wrap gap-1.5">
              {LISTING_DURATION_OPTIONS.map((option) => (
                <button
                  key={option.hours}
                  type="button"
                  onClick={() => setDurationHours(option.hours)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                    durationHours === option.hours
                      ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {priceValid && (
              <p className={`text-[11px] ${canAffordFee ? 'text-slate-500' : 'text-amber-400'}`}>
                Listing fee: {fee.toLocaleString()} {currencyLabel(priceCurrency)} (forfeited whether or not it sells) — you have{' '}
                {balance.toLocaleString()}
              </p>
            )}

            <button
              type="button"
              disabled={busy || !draft || !priceValid || !canAffordFee}
              onClick={() => void handleList()}
              className="rounded-lg border border-emerald-600 bg-emerald-500/10 px-4 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Listing…' : 'List Item'}
            </button>
            {error && <p className="text-xs text-amber-400">{error}</p>}
          </div>
        </div>

        <InventoryPanel
          columns={5}
          reservedItemIds={draft ? [draft.kind === 'item' ? draft.itemId : draft.dragId] : []}
          onTileDrop={handleTileDrop}
        />
      </div>
    </DragDropProvider>
  )
}

function MyListingsTab({ characterId, templates }: { characterId: string; templates: ItemTemplate[] }) {
  const myListings = useMarketplaceStore((state) => state.myListings)
  const busy = useMarketplaceStore((state) => state.busy)
  const endListing = useMarketplaceStore((state) => state.endListing)
  const [error, setError] = useState<string | null>(null)

  const handleEnd = async (listingId: string) => {
    setError(null)
    const result = await endListing(characterId, listingId)
    if (!result.ok) {
      setError('Something went wrong.')
    }
  }

  const activeListings = myListings.filter((listing) => listing.status === 'active')
  const historyListings = myListings.filter((listing) => listing.status !== 'active')

  return (
    <div className="space-y-4">
      <ListAnItemForm characterId={characterId} />

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-200">Active Listings</p>
        {error && <p className="text-xs text-amber-400">{error}</p>}
        {activeListings.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing listed right now.</p>
        ) : (
          <div className="space-y-2">
            {activeListings.map((listing) => (
              <ListingRow
                key={listing.id}
                listing={listing}
                templates={templates}
                action={
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleEnd(listing.id)}
                    className="rounded-lg border border-red-800 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                }
              />
            ))}
          </div>
        )}
      </div>

      {historyListings.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-200">History</p>
          <div className="space-y-2">
            {historyListings.map((listing) => (
              <ListingRow key={listing.id} listing={listing} templates={templates} action={null} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function reasonLabel(reason: MailEntry['reason']): string {
  switch (reason) {
    case 'purchase':
      return 'Bought from Marketplace'
    case 'listing_cancelled':
      return 'Listing cancelled'
    case 'listing_expired':
      return 'Listing expired unsold'
  }
}

function MailTab({ characterId, templates }: { characterId: string; templates: ItemTemplate[] }) {
  const entries = useMailStore((state) => state.entries)
  const busy = useMailStore((state) => state.busy)
  const claim = useMailStore((state) => state.claim)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [claimAllBusy, setClaimAllBusy] = useState(false)

  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null
  const selectedTemplate = selectedEntry?.item ? (templates.find((t) => t.id === selectedEntry.item!.template_id) ?? null) : null
  const selectedLabel = selectedEntry
    ? selectedEntry.currency_type
      ? listableCurrencyLabel(selectedEntry.currency_type)
      : selectedEntry.item
        ? formatItemDisplayName(selectedTemplate?.name ?? 'Unknown item', selectedEntry.item.quality_tier, selectedEntry.item.composition_level)
        : 'Item unavailable'
    : ''

  const handleClaim = async () => {
    if (!selectedEntry) {
      return
    }
    setError(null)
    const result = await claim(characterId, selectedEntry.id)
    if (result.ok) {
      setSelectedId(null)
    } else {
      setError("Couldn't claim that.")
    }
  }

  const handleClaimAll = async () => {
    setClaimAllBusy(true)
    const results = await Promise.all(entries.map((entry) => claim(characterId, entry.id)))
    const failures = results.filter((result) => !result.ok).length
    setClaimAllBusy(false)
    setSelectedId(null)
    if (failures > 0) {
      setError(`Couldn't claim ${failures} item${failures === 1 ? '' : 's'}.`)
    }
  }

  if (entries.length === 0) {
    return <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">No mail</p>
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={claimAllBusy}
        onClick={() => void handleClaimAll()}
        className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {claimAllBusy ? 'Claiming…' : `Claim All (${entries.length})`}
      </button>

      <div className="overflow-x-auto">
        <div className="grid grid-cols-[repeat(8,3.5rem)] gap-1.5 lg:grid-cols-[repeat(8,4rem)]">
          {entries.map((entry) => {
            if (entry.currency_type) {
              const visual = listableCurrencyVisual(entry.currency_type)
              return (
                <InventorySlot
                  key={entry.id}
                  slotId={entry.id}
                  filled
                  sizeClassName={SLOT_SIZE_CLASS}
                  icon={visual.icon}
                  iconSrc={visual.iconSrc}
                  qualityColor={visual.qualityColor}
                  label={listableCurrencyLabel(entry.currency_type)}
                  selected={selectedId === entry.id}
                  onClick={() => {
                    setSelectedId((current) => (current === entry.id ? null : entry.id))
                    setError(null)
                  }}
                />
              )
            }

            const template = entry.item ? templates.find((t) => t.id === entry.item!.template_id) : undefined
            const label = entry.item
              ? formatItemDisplayName(template?.name ?? 'Unknown item', entry.item.quality_tier, entry.item.composition_level)
              : 'Item unavailable'

            return (
              <InventorySlot
                key={entry.id}
                slotId={entry.id}
                filled={Boolean(entry.item)}
                sizeClassName={SLOT_SIZE_CLASS}
                icon={entry.item ? getItemIcon(template?.slot_type) : undefined}
                iconSrc={entry.item ? getGearIconSrc(template?.name) : undefined}
                qualityColor={entry.item ? getQualityColor(entry.item.quality_tier) : undefined}
                label={label}
                tooltip={entry.item ? buildGearTooltip(entry.item, template) : undefined}
                selected={selectedId === entry.id}
                onClick={() => {
                  setSelectedId((current) => (current === entry.id ? null : entry.id))
                  setError(null)
                }}
              />
            )
          })}
        </div>
      </div>

      {selectedEntry && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-sm font-medium text-slate-200">{selectedLabel}</p>
          <p className="text-[11px] text-slate-500">{reasonLabel(selectedEntry.reason)}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleClaim()}
            className="mt-2 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Claim
          </button>
        </div>
      )}
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  )
}

export default function MarketplacePanel() {
  const characterId = useActiveCharacterStore((state) => state.characterId)
  const templates = useItemTemplatesStore((state) => state.templates)
  const mailCount = useMailStore((state) => state.entries.length)

  const [tab, setTab] = useState<MarketTab>('browse')

  if (!characterId) {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => setTab('browse')}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            tab === 'browse' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Browse
        </button>
        <button
          type="button"
          onClick={() => setTab('my-listings')}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            tab === 'my-listings' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          My Listings
        </button>
        <button
          type="button"
          onClick={() => setTab('mail')}
          className={`relative rounded-lg border px-3 py-1.5 text-xs font-medium ${
            tab === 'mail' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Mail
          {mailCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-slate-950">
              {mailCount}
            </span>
          )}
        </button>
      </div>

      {tab === 'browse' && <BrowseTab characterId={characterId} templates={templates} />}
      {tab === 'my-listings' && <MyListingsTab characterId={characterId} templates={templates} />}
      {tab === 'mail' && <MailTab characterId={characterId} templates={templates} />}
    </div>
  )
}
