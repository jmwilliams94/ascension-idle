// Mirrors create_marketplace_listing's fee formula in
// supabase/migrations/20260802050000_add_marketplace.sql — preview only, for
// showing the player their fee before they commit. The actual fee is always
// computed server-side; if these drift out of sync the worst case is a wrong
// preview number, not a wrong charge. Keep them in sync.
export function previewListingFee(priceAmount: number): number {
  if (!Number.isFinite(priceAmount) || priceAmount <= 0) {
    return 0
  }
  return Math.ceil(priceAmount * 0.05)
}

export type ListingCurrency = 'gold' | 'ascension_points'

// Fixed presets shown in the UI — the RPC itself accepts any 1-168 hour
// value, so this list is just a convenience, not a hard constraint. Easy to
// adjust later.
export const LISTING_DURATION_OPTIONS: { label: string; hours: number }[] = [
  { label: '6 hours', hours: 6 },
  { label: '12 hours', hours: 12 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
]
