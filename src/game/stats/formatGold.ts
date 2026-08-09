// Tiered gold display for the top HUD bar (ExpBar.tsx), requested by the
// user 2026-08-13 — a flat toLocaleString() number got hard to read once
// gold grew past a few hundred thousand. Three magnitude bands, each with
// its own color, so the player can eyeball roughly how much they have at a
// glance without reading every digit.
//
// Formatting:
//   < 1,000: a plain number, e.g. "500".
//   1,000 - 999,999: whole thousands, e.g. "1k", "999k".
//   1,000,000 - 9,999,999: two decimal places, e.g. "1.23M", "9.87M".
//   >= 10,000,000: whole millions, no decimals, e.g. "15M", "19M".
//
// Color:
//   <= 100,000: gold (matches every other gold readout in the app).
//   100,000 - 9,999,999: white.
//   >= 10,000,000: cyan.
export function formatGoldAmount(amount: number): string {
  const value = Math.max(0, Math.floor(amount))
  if (value < 1000) {
    // Below the k/M tiers there's no letter suffix to mark this as gold —
    // keep the existing "Ng" suffix so it still reads as currency at a
    // glance (the k/M tiers don't need it, the letter already does that job).
    return `${value.toLocaleString()}g`
  }
  if (value < 1_000_000) {
    return `${Math.floor(value / 1000)}k`
  }
  if (value < 10_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`
  }
  return `${Math.floor(value / 1_000_000)}M`
}

export function goldColorClass(amount: number): string {
  const value = Math.max(0, Math.floor(amount))
  if (value <= 100_000) {
    return 'text-amber-300'
  }
  if (value < 10_000_000) {
    return 'text-white'
  }
  return 'text-cyan-300'
}
