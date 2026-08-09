// Mirrors create_marketplace_listing's fee formula in
// supabase/migrations/20260813020000_marketplace_seller_name_and_free_small_fee.sql
// (originally 20260802050000_add_marketplace.sql, ceil-only) — preview only,
// for showing the player their fee before they commit. The actual fee is
// always computed server-side; if these drift out of sync the worst case is
// a wrong preview number, not a wrong charge. Keep them in sync.
//
// Free below price 20 (2026-08-13, requested by the user): the true
// (unrounded) 5% only reaches a whole 1 unit at price 20 — below that, the
// old plain `ceil` forced a 1-unit minimum fee that was disproportionately
// more than 5% of a cheap listing's price (e.g. a price-5 listing paid a
// 1-unit fee, actually 20%). Unchanged for price >= 20.
export function previewListingFee(priceAmount: number): number {
  if (!Number.isFinite(priceAmount) || priceAmount <= 0) {
    return 0
  }
  const rawFee = priceAmount * 0.05
  return rawFee < 1 ? 0 : Math.ceil(rawFee)
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
