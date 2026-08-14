import { useEffect, useState, type ReactNode } from 'react'
import InventoryPanel from './InventoryPanel'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import MarketplaceListingSlot, { type ListingDraftTarget } from './MarketplaceListingSlot'
import { DragDropProvider } from './dragDrop'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../game/items/useItemTemplatesStore'
import {
  useMarketplaceStore,
  type ListableCurrencyType,
  type ListingTarget,
  type MarketplaceListing,
  type ListingCurrency,
} from '../game/marketplace/useMarketplaceStore'
import { useMailStore, groupMailEntries, countUnreadMail, type MailEntry, type MailGroup } from '../game/marketplace/useMailStore'
import {
  listableCurrencyLabel,
  listableCurrencyVisual,
  mailCurrencyLabel,
  mailCurrencyVisual,
  mailCurrencyTooltip,
} from '../game/marketplace/listableCurrency'
import { LISTING_DURATION_OPTIONS, previewListingFee } from '../game/marketplace/marketplaceCosts'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import {
  buildGearTooltip,
  formatItemDisplayName,
  getGearIconSrc,
  getItemIcon,
  getQualityColor,
  itemHasDurability,
} from '../game/items/equipmentBonus'
import { isFallenStarDragId, isFallenStarScrollDragId, isCometDragId, isCometScrollDragId } from '../game/items/forgeCosts'

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

// A synthetic ItemInstance built from a listing's own item_* snapshot
// columns (see useMarketplaceStore's MarketplaceListing doc comment) — used
// once listing.item is no longer readable (a completed sale), so history can
// still show exactly what was actually sold instead of "Item unavailable."
// Mirrors LootHoldingCard.tsx's previewInstanceForEntry — same idea, a
// different real source (a DB snapshot here, not a not-yet-owned template).
function snapshotPreviewItem(listing: MarketplaceListing): ItemInstance | null {
  if (!listing.item_template_id || !listing.item_quality_tier) {
    return null
  }
  return {
    id: listing.id,
    template_id: listing.item_template_id,
    owner_id: '',
    quality_tier: listing.item_quality_tier,
    level: listing.item_level ?? 1,
    composition_level: listing.item_composition_level ?? 0,
    composition_points: 0,
    sockets: [],
    enchant: null,
    // Not part of the item_* snapshot columns (durability didn't exist when
    // that snapshot shipped) — defaults to 0 purely to satisfy the type;
    // ListingTile deliberately keys its "broken" badge off listing.item (the
    // real live item) rather than this synthetic preview, so this value is
    // never actually read for that purpose.
    durability: 0,
    created_at: listing.created_at,
    location: 'inventory',
  }
}

// A listing's own label — a real gear name (from the live item while it's
// still readable, or the item_* snapshot once it's not), or one of the 4
// listable currency type labels, or a placeholder only for a currency-less
// gear listing with no snapshot at all (created before the snapshot
// migration shipped — see that migration's own header for why this can't be
// backfilled).
function listingLabel(listing: MarketplaceListing, templates: ItemTemplate[]): string {
  if (listing.currency_type) {
    return listableCurrencyLabel(listing.currency_type)
  }
  const resolved = listing.item ?? snapshotPreviewItem(listing)
  const template = resolved ? templates.find((t) => t.id === resolved.template_id) : undefined
  return resolved
    ? formatItemDisplayName(template?.name ?? 'Unknown item', resolved.quality_tier, resolved.composition_level)
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

  const resolved = listing.item ?? snapshotPreviewItem(listing)
  const template = resolved ? templates.find((t) => t.id === resolved.template_id) : undefined
  const label = listingLabel(listing, templates)
  const icon = getItemIcon(template?.slot_type)
  const iconSrc = getGearIconSrc(template?.name)

  return (
    <InventorySlot
      slotId={listing.id}
      filled={Boolean(resolved)}
      sizeClassName={SLOT_SIZE_CLASS}
      icon={resolved ? icon : undefined}
      iconSrc={resolved ? iconSrc : undefined}
      qualityColor={resolved ? getQualityColor(resolved.quality_tier) : undefined}
      compositionLevel={resolved?.composition_level}
      // Keyed off the real live item, not `resolved` (which can fall back to
      // snapshotPreviewItem's synthetic durability: 0 for an unavailable
      // historical listing) — a snapshot preview has no real durability data.
      broken={listing.item && itemHasDurability(template?.slot_type) ? listing.item.durability <= 0 : undefined}
      label={label}
      tooltip={resolved ? buildGearTooltip(resolved, template) : undefined}
    />
  )
}

// showSeller (Browse tab only — My Listings' rows are always the viewer's
// own character, so naming them again would be redundant) — falls back to
// "Unknown seller" only for a listing created before the seller-name
// snapshot shipped (2026-08-13), never for a genuinely blank name.
function ListingRow({
  listing,
  templates,
  action,
  showSeller = false,
}: {
  listing: MarketplaceListing
  templates: ItemTemplate[]
  action: ReactNode
  showSeller?: boolean
}) {
  const label = listingLabel(listing, templates)

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <ListingTile listing={listing} templates={templates} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-200">{label}</p>
        {showSeller && <p className="text-[11px] text-sky-400/80">Sold by {listing.seller_character_name ?? 'Unknown seller'}</p>}
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
        <Button variant="secondary" onClick={() => void loadBrowseListings()}>
          Refresh
        </Button>
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
              showSeller
              action={
                listing.seller_character_id === characterId ? (
                  <span className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-500">Your listing</span>
                ) : confirmingId === listing.id ? (
                  <div className="flex gap-2">
                    <Button variant="primary" disabled={busy} onClick={() => void handleBuy(listing.id)}>
                      {busy ? 'Working…' : 'Confirm'}
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setError(null)
                      setConfirmingId(listing.id)
                    }}
                  >
                    Buy
                  </Button>
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
  const fee = priceValid ? previewListingFee(parsedPrice, priceCurrency) : 0
  const balance = priceCurrency === 'gold' ? gold : ascensionPoints
  // A 0 fee (below the currency's own free-threshold, see previewListingFee)
  // is always affordable — it
  // used to be gated behind `fee > 0`, which incorrectly blocked the List
  // button entirely for a free listing.
  const canAffordFee = balance >= fee

  const handleDropTarget = (dragId: string) => {
    if (isCometDragId(dragId)) {
      setDraft({ kind: 'currency', dragId, currencyType: 'comet' })
      setError(null)
      return
    }
    if (isFallenStarDragId(dragId)) {
      setDraft({ kind: 'currency', dragId, currencyType: 'fallen_star' })
      setError(null)
      return
    }
    if (isCometScrollDragId(dragId)) {
      setDraft({ kind: 'currency', dragId, currencyType: 'comet_scroll' })
      setError(null)
      return
    }
    if (isFallenStarScrollDragId(dragId)) {
      setDraft({ kind: 'currency', dragId, currencyType: 'fallen_star_scroll' })
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
      <AscensionCard title="List an Item" contentClassName="space-y-3 p-4">
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
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-base text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
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
                Listing fee:{' '}
                {fee > 0 ? (
                  <>
                    {fee.toLocaleString()} {currencyLabel(priceCurrency)} (forfeited whether or not it sells) — you have{' '}
                    {balance.toLocaleString()}
                  </>
                ) : (
                  <span className="text-emerald-400">Free</span>
                )}
              </p>
            )}

            <Button variant="primary" disabled={busy || !draft || !priceValid || !canAffordFee} onClick={() => void handleList()}>
              {busy ? 'Listing…' : 'List Item'}
            </Button>
            {error && <p className="text-xs text-amber-400">{error}</p>}
          </div>
        </div>

        <InventoryPanel
          columns={5}
          reservedItemIds={draft ? [draft.kind === 'item' ? draft.itemId : draft.dragId] : []}
          onTileDrop={handleTileDrop}
        />
      </AscensionCard>
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
                  <Button variant="danger" disabled={busy} onClick={() => void handleEnd(listing.id)}>
                    Cancel
                  </Button>
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
    case 'admin_gift':
      return 'Gift'
    case 'bug_report_reward':
      return 'Bug Report Reward'
  }
}

function mailEntryLabel(entry: MailEntry, templates: ItemTemplate[]): string {
  if (entry.currency_type) {
    return mailCurrencyLabel(entry.currency_type)
  }
  if (entry.item) {
    const template = templates.find((t) => t.id === entry.item!.template_id)
    return formatItemDisplayName(template?.name ?? 'Unknown item', entry.item.quality_tier, entry.item.composition_level)
  }
  return 'Item unavailable'
}

// One reward tile — a currency unit or a gear item — shared by the main Mail
// grid (ungrouped/single-row entries) and a batch card's own reward row
// (Admin Mail, 2026-08-13), so both render identically. `selected`/`onClick`
// are omitted entirely for a batch card's purely informational tiles (see
// MailTab below). Currency tiles now always carry a real tooltip
// (mailCurrencyTooltip) — fixed 2026-08-13, reported by the user: only gear
// tiles had one before, Comet/Fallen Star/etc. tiles had no hover info at
// all (InventorySlot's native `title` fallback only fires when `tooltip` is
// omitted, and it was never a reliable substitute).
function MailEntryTile({
  entry,
  templates,
  selected = false,
  onClick,
}: {
  entry: MailEntry
  templates: ItemTemplate[]
  selected?: boolean
  onClick?: () => void
}) {
  if (entry.currency_type) {
    const visual = mailCurrencyVisual(entry.currency_type)
    return (
      <InventorySlot
        slotId={entry.id}
        filled
        sizeClassName={SLOT_SIZE_CLASS}
        icon={visual.icon}
        iconSrc={visual.iconSrc}
        qualityColor={visual.qualityColor}
        label={mailCurrencyLabel(entry.currency_type)}
        tooltip={mailCurrencyTooltip(entry.currency_type, entry.amount)}
        badge={entry.amount && entry.amount > 1 ? String(entry.amount) : undefined}
        selected={selected}
        onClick={onClick}
      />
    )
  }

  const template = entry.item ? templates.find((t) => t.id === entry.item!.template_id) : undefined

  return (
    <InventorySlot
      slotId={entry.id}
      filled={Boolean(entry.item)}
      sizeClassName={SLOT_SIZE_CLASS}
      icon={entry.item ? getItemIcon(template?.slot_type) : undefined}
      iconSrc={entry.item ? getGearIconSrc(template?.name) : undefined}
      qualityColor={entry.item ? getQualityColor(entry.item.quality_tier) : undefined}
      compositionLevel={entry.item?.composition_level}
      broken={entry.item && itemHasDurability(template?.slot_type) ? entry.item.durability <= 0 : undefined}
      label={mailEntryLabel(entry, templates)}
      tooltip={entry.item ? buildGearTooltip(entry.item, template) : undefined}
      selected={selected}
      onClick={onClick}
    />
  )
}

function mailGroupSender(group: MailGroup): string {
  return group.entries[0].sender_label ?? 'Market'
}

function mailGroupSubject(group: MailGroup): string {
  return group.entries[0].subject ?? reasonLabel(group.entries[0].reason)
}

function isGroupUnclaimed(group: MailGroup): boolean {
  return group.entries.some((entry) => entry.claimed_at === null)
}

// Horizontal inbox-style row (2026-08-13 redesign, requested by the user —
// supersedes the earlier tile-grid layout). A small sky dot marks a group
// with at least one still-unclaimed row; a fully-claimed group dims instead,
// same "history" treatment either way — clicking any row opens
// MailDetailModal for the full content.
function MailRow({ group, onClick }: { group: MailGroup; onClick: () => void }) {
  const unread = isGroupUnclaimed(group)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left text-xs transition-colors ${
        unread ? 'border-slate-700 bg-slate-900/60 hover:border-slate-500' : 'border-slate-800 bg-slate-950/40 opacity-60 hover:opacity-80'
      }`}
    >
      {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />}
      <span className={`w-20 shrink-0 truncate font-medium ${unread ? 'text-slate-200' : 'text-slate-400'}`}>
        {mailGroupSender(group)}
      </span>
      <span className="min-w-0 flex-1 truncate text-slate-400">{mailGroupSubject(group)}</span>
      {group.entries.length > 1 && <span className="shrink-0 text-[10px] text-slate-600">×{group.entries.length}</span>}
      <span className="shrink-0 text-[10px] text-slate-600">{new Date(group.entries[0].created_at).toLocaleDateString()}</span>
    </button>
  )
}

// Popup overlay (2026-08-13, requested by the user) showing a mail group's
// full content — same fixed-inset-0-backdrop shell SettingsModal.tsx
// already establishes. Doesn't force-close on a successful claim; it just
// re-renders with `canClaim` now false (the underlying `entries` update
// flows back down from useMailStore), same "you can keep reading after
// collecting something" shape a real inbox has.
function MailDetailModal({
  group,
  templates,
  busy,
  onClaim,
  onClose,
}: {
  group: MailGroup
  templates: ItemTemplate[]
  busy: boolean
  onClaim: () => void
  onClose: () => void
}) {
  const canClaim = isGroupUnclaimed(group)
  const message = group.entries[0].message
  // Message-only mail (2026-08-13, requested by the user) — a row with
  // neither item_id nor currency_type set (see mail_optional_rewards.sql)
  // has nothing to show as a tile; filtered out rather than rendering an
  // empty InventorySlot. A batch is either all-reward or all-message-only
  // (admin_send_mail never mixes the two in one send), so this is really
  // just an emptiness check, but filtering is defensive either way.
  const rewardEntries = group.entries.filter((entry) => entry.item_id !== null || entry.currency_type !== null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xs space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">From: {mailGroupSender(group)}</p>
            <p className="text-sm font-semibold text-slate-100">{mailGroupSubject(group)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        {message && <p className="whitespace-pre-wrap text-xs text-slate-400">{message}</p>}

        {rewardEntries.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {rewardEntries.map((entry) => (
              <MailEntryTile key={entry.id} entry={entry} templates={templates} />
            ))}
          </div>
        )}

        {canClaim ? (
          <Button variant="primary" disabled={busy} onClick={onClaim} className="w-full">
            {busy ? 'Claiming…' : rewardEntries.length > 0 ? 'Claim' : 'Mark as Read'}
          </Button>
        ) : (
          <p className="text-center text-[11px] text-slate-600">{rewardEntries.length > 0 ? 'Claimed' : 'Read'}</p>
        )}
      </div>
    </div>
  )
}

function MailTab({ characterId, templates }: { characterId: string; templates: ItemTemplate[] }) {
  const entries = useMailStore((state) => state.entries)
  const busy = useMailStore((state) => state.busy)
  const claim = useMailStore((state) => state.claim)
  const clearHistory = useMailStore((state) => state.clearHistory)

  const [openKey, setOpenKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [claimAllBusy, setClaimAllBusy] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)

  const groups = groupMailEntries(entries)
  const orderedGroups = [...groups].reverse() // newest first — loadMail itself stays ascending
  const openGroup = orderedGroups.find((group) => group.key === openKey) ?? null
  const unclaimedEntries = entries.filter((entry) => entry.claimed_at === null)
  const claimedCount = entries.length - unclaimedEntries.length

  const handleClaimGroup = async (group: MailGroup) => {
    setError(null)
    const targets = group.entries.filter((entry) => entry.claimed_at === null)
    const results = await Promise.all(targets.map((entry) => claim(characterId, entry.id)))
    const failures = results.filter((result) => !result.ok).length
    if (failures > 0) {
      setError(`Couldn't claim ${failures} item${failures === 1 ? '' : 's'}.`)
    }
  }

  const handleClaimAll = async () => {
    setClaimAllBusy(true)
    const results = await Promise.all(unclaimedEntries.map((entry) => claim(characterId, entry.id)))
    const failures = results.filter((result) => !result.ok).length
    setClaimAllBusy(false)
    if (failures > 0) {
      setError(`Couldn't claim ${failures} item${failures === 1 ? '' : 's'}.`)
    }
  }

  const handleClear = async () => {
    setClearBusy(true)
    const result = await clearHistory(characterId)
    setClearBusy(false)
    if (!result.ok) {
      setError("Couldn't clear history.")
    }
  }

  if (entries.length === 0) {
    return <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">No mail</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={claimAllBusy || unclaimedEntries.length === 0} onClick={() => void handleClaimAll()}>
          {claimAllBusy ? 'Claiming…' : `Claim All (${unclaimedEntries.length})`}
        </Button>
        <Button variant="secondary" disabled={clearBusy || claimedCount === 0} onClick={() => void handleClear()}>
          {clearBusy ? 'Clearing…' : `Clear History (${claimedCount})`}
        </Button>
      </div>

      <div className="mx-auto w-full max-w-sm space-y-2">
        {orderedGroups.map((group) => (
          <MailRow key={group.key} group={group} onClick={() => setOpenKey(group.key)} />
        ))}
      </div>

      {error && <p className="text-xs text-amber-400">{error}</p>}

      {openGroup && (
        <MailDetailModal
          group={openGroup}
          templates={templates}
          busy={busy}
          onClaim={() => void handleClaimGroup(openGroup)}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  )
}

export default function MarketplacePanel() {
  const characterId = useActiveCharacterStore((state) => state.characterId)
  const templates = useItemTemplatesStore((state) => state.templates)
  // Unread mail count, not raw row count (2026-08-13 fix — this pill had
  // drifted out of sync with the nav-badge fix that already used
  // countUnreadMail elsewhere).
  const mailEntries = useMailStore((state) => state.entries)
  const mailCount = countUnreadMail(mailEntries)

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
