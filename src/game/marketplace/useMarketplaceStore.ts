import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'
import type { ItemInstance } from '../items/useInventoryStore'
import { useProgressionStore } from '../stats/useProgressionStore'
import { usePlayerRecordStore } from '../../lib/usePlayerRecordStore'

// Marketplace (see CLAUDE.md's Gear system / Marketplace section and
// supabase/migrations/20260802050000_add_marketplace.sql). Every mutation
// goes through one of three SECURITY DEFINER RPCs — this store never writes
// marketplace_listings directly (no client insert/update/delete grant exists
// on it at all).
export type ListingStatus = 'active' | 'sold' | 'cancelled' | 'expired'
export type ListingCurrency = 'gold' | 'ascension_points'

export interface MarketplaceListing {
  id: string
  seller_character_id: string
  item_id: string
  price_currency: ListingCurrency
  price_amount: number
  fee_amount: number
  status: ListingStatus
  buyer_character_id: string | null
  created_at: string
  expires_at: string
  sold_at: string | null
  // Hydrated client-side by a follow-up item_instances fetch, not a DB join
  // (matches this codebase's established "flat selects, join client-side by
  // id" convention — see useAchievementsStore). Absent for a 'sold' entry in
  // My Listings history: once ownership moves to the buyer, the seller's own
  // item_instances RLS no longer matches it (it's not actively listed
  // anymore either) — a known, disclosed display-only gap, not a bug.
  item?: ItemInstance
}

interface CreateListingResult {
  ok: boolean
  error?: string
  listing_id?: string
  fee?: number
  gold?: number
  ascension_points?: number
}

interface BuyListingResult {
  ok: boolean
  error?: string
  gold?: number
  ascension_points?: number
}

interface EndListingResult {
  ok: boolean
  error?: string
  status?: 'cancelled' | 'expired'
}

async function hydrateItems(listings: MarketplaceListing[]): Promise<MarketplaceListing[]> {
  const itemIds = [...new Set(listings.map((listing) => listing.item_id))]
  if (itemIds.length === 0) {
    return listings
  }

  const { data } = await supabase.from('item_instances').select('*').in('id', itemIds)
  const byId = new Map((data ?? []).map((item) => [item.id, item as ItemInstance]))

  return listings.map((listing) => ({ ...listing, item: byId.get(listing.item_id) }))
}

interface MarketplaceState {
  browseListings: MarketplaceListing[]
  myListings: MarketplaceListing[]
  browseLoaded: boolean
  myListingsLoaded: boolean
  busy: boolean
  // Public feed — every other account's active listings. Loaded on demand
  // when the Browse sub-tab is opened, not eager-loaded at game start like
  // everything else in GameShell — it's a live cross-account feed, not "your
  // own state."
  loadBrowseListings: (characterId: string) => Promise<void>
  // This character's own listings, active and historical — eager-loaded in
  // GameShell alongside Warehouse/Loot Holding/Achievements.
  loadMyListings: (characterId: string) => Promise<void>
  // Used by InventoryPanel's visibleItems filter — hides an item mid-listing
  // the same way isEquipped already hides an equipped one.
  isListed: (itemId: string) => boolean
  createListing: (
    characterId: string,
    itemId: string,
    priceCurrency: ListingCurrency,
    priceAmount: number,
    durationHours: number,
  ) => Promise<CreateListingResult>
  buyListing: (characterId: string, listingId: string) => Promise<BuyListingResult>
  endListing: (characterId: string, listingId: string) => Promise<EndListingResult>
}

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  browseListings: [],
  myListings: [],
  browseLoaded: false,
  myListingsLoaded: false,
  busy: false,

  loadBrowseListings: async (characterId) => {
    const { data, error } = await supabase
      .from('marketplace_listings')
      .select('*')
      .eq('status', 'active')
      .neq('seller_character_id', characterId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to load marketplace browse listings', error)
      return
    }

    // Client-side filter for anything whose expires_at has already passed
    // but hasn't been lazily swept yet (see buy_marketplace_listing) — never
    // shown as buyable even before that sweep touches it.
    const now = Date.now()
    const unexpired = (data ?? []).filter((listing) => new Date(listing.expires_at).getTime() > now) as MarketplaceListing[]

    const hydrated = await hydrateItems(unexpired)
    set({ browseListings: hydrated, browseLoaded: true })
  },

  loadMyListings: async (characterId) => {
    const { data, error } = await supabase
      .from('marketplace_listings')
      .select('*')
      .eq('seller_character_id', characterId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to load my marketplace listings', error)
      return
    }

    const hydrated = await hydrateItems((data ?? []) as MarketplaceListing[])
    set({ myListings: hydrated, myListingsLoaded: true })
  },

  isListed: (itemId) => get().myListings.some((listing) => listing.status === 'active' && listing.item_id === itemId),

  createListing: async (characterId, itemId, priceCurrency, priceAmount, durationHours) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('create_marketplace_listing', {
      p_character_id: characterId,
      p_item_id: itemId,
      p_price_currency: priceCurrency,
      p_price_amount: priceAmount,
      p_duration_hours: durationHours,
    })
    set({ busy: false })

    if (error) {
      console.error('Create marketplace listing call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as CreateListingResult

    if (result.ok) {
      if (typeof result.gold === 'number') {
        useProgressionStore.getState().setGold(result.gold)
      }
      if (typeof result.ascension_points === 'number') {
        usePlayerRecordStore.getState().setAscensionPoints(result.ascension_points)
      }
      await get().loadMyListings(characterId)
    }

    return result
  },

  buyListing: async (characterId, listingId) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('buy_marketplace_listing', {
      p_character_id: characterId,
      p_listing_id: listingId,
    })
    set({ busy: false })

    if (error) {
      console.error('Buy marketplace listing call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as BuyListingResult

    if (result.ok) {
      if (typeof result.gold === 'number') {
        useProgressionStore.getState().setGold(result.gold)
      }
      if (typeof result.ascension_points === 'number') {
        usePlayerRecordStore.getState().setAscensionPoints(result.ascension_points)
      }
      set((state) => ({ browseListings: state.browseListings.filter((listing) => listing.id !== listingId) }))
    }

    return result
  },

  endListing: async (characterId, listingId) => {
    set({ busy: true })
    const { data, error } = await supabase.rpc('end_marketplace_listing', {
      p_character_id: characterId,
      p_listing_id: listingId,
    })
    set({ busy: false })

    if (error) {
      console.error('End marketplace listing call failed', error)
      return { ok: false, error: 'rpc_failed' }
    }

    const result = data as EndListingResult

    if (result.ok) {
      await get().loadMyListings(characterId)
    }

    return result
  },
}))
