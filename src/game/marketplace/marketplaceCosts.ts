export type ListingCurrency = 'gold' | 'ascension_points'

// Mirrors create_marketplace_listing's fee formula in
// supabase/migrations/20260813030000_marketplace_ap_listing_fee_rate.sql
// (originally 20260802050000_add_marketplace.sql, flat 5% ceil-only) —
// preview only, for showing the player their fee before they commit. The
// actual fee is always computed server-side; if these drift out of sync the
// worst case is a wrong preview number, not a wrong charge. Keep them in
// sync.
//
// Ascension-Points-priced listings pay 1%, Gold-priced pay 5% (2026-08-13,
// requested by the user).
//
// Free below the price where the true (unrounded) fee reaches a whole 1
// unit — price 20 for Gold's 5%, price 100 for AP's 1% (2026-08-13,
// requested by the user): below that, the old plain `ceil` forced a 1-unit
// minimum fee that was disproportionately more than the nominal rate on a
// cheap listing (e.g. a Gold price-5 listing paid a 1-unit fee, actually
// 20% not 5%). Unchanged above that threshold.
export function previewListingFee(priceAmount: number, currency: ListingCurrency): number {
  if (!Number.isFinite(priceAmount) || priceAmount <= 0) {
    return 0
  }
  const feeRate = currency === 'ascension_points' ? 0.01 : 0.05
  const rawFee = priceAmount * feeRate
  return rawFee < 1 ? 0 : Math.ceil(rawFee)
}

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
