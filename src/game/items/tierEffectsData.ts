// Data/logic half of the radiating-ember tier effect — split from
// tierEffects.tsx (which holds the actual TierEmberEffect component)
// because a file mixing component and non-component exports breaks React
// Fast Refresh, same reason dragDrop.tsx/dragDropContext.ts are split.
//
// See tierEffects.tsx for the full design rationale (confirmed 2026-08-02
// after many rounds of user iteration in Settings' Item Effects gallery).

// Confirmed with the user (2026-08-02): once Gems exist as real items (not
// built yet — see CLAUDE.md's Gem system section), they'll use a 3-tier
// ladder (Normal -> Tempered -> Ascended, skipping Infused/Radiant) rather
// than gear's full 5. Whoever builds that should reuse this same table —
// Tempered gems mapping to the same density as gear's Tempered (5),
// Ascended gems to the same density as gear's Ascended (100) — rather than
// inventing a separate density scale. Gem colors themselves aren't decided
// yet (8 gem types each have their own flavor — Dragon/Phoenix/etc. — a
// separate axis from tier), so this table can't be extended for gems until
// that's designed.
export const EMBER_DENSITY_BY_COLOR: Record<string, number> = {
  // Gear quality tiers (QUALITY_COLORS in equipmentBonus.ts) — must stay in
  // sync if those values ever change. Normal (#FFFFFF) intentionally omitted.
  '#4FC3F7': 5, // Tempered
  '#2E5EAA': 10, // Infused
  '#A855F7': 25, // Radiant
  '#EF4444': 100, // Ascended
  // Rare material colors (forgeCosts.ts) — must stay in sync. Not tiered the
  // way gear/gems are, so both share one "valuable" density rather than an
  // escalating scale.
  '#C8D0DC': 10, // MATERIAL_COLOR
  '#F0B87A': 10, // FALLEN_STAR_COLOR
}

export function emberCountForColor(color: string | undefined): number {
  if (!color) {
    return 0
  }
  return EMBER_DENSITY_BY_COLOR[color] ?? 0
}

// Tiny deterministic PRNG (mulberry32) so a given tile's ember layout is
// stable across re-renders (no jitter every time the surrounding UI
// re-renders) while still looking organically varied from tile to tile.
// Exported so call sites needing their own seeded randomness (e.g.
// FireworkOverlay's burst-point layout) can use it instead of Math.random,
// which the react-hooks/purity lint rule forbids calling during render.
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Turns any string (e.g. an item's own id) into a stable numeric seed, so
// every tile gets its own distinct-looking ember pattern without needing an
// explicit seed prop threaded through every call site.
export function seedFromId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return h === 0 ? 1 : h
}

export interface RadiateEmberConfig {
  size: number
  delay: string
  duration: string
  dx: string
  dy: string
}

// Each ember launches from the tile's own center outward at a random angle/
// distance. `radius` defaults to roughly a standard tile's own half-width
// (SLOT_SIZE_CLASS tops out at 4rem/64px), so embers travel out to the
// tile's actual edge rather than stopping short in the middle.
export function buildRadiateEmbers(count: number, seed: number, radius = 32): RadiateEmberConfig[] {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, () => {
    const angle = rand() * Math.PI * 2
    const distance = radius * (0.75 + rand() * 0.5)
    return {
      size: 2 + Math.round(rand() * 2),
      delay: `${(rand() * 2.2).toFixed(2)}s`,
      duration: `${(1.7 + rand() * 0.9).toFixed(2)}s`,
      dx: `${(Math.cos(angle) * distance).toFixed(1)}px`,
      dy: `${(Math.sin(angle) * distance).toFixed(1)}px`,
    }
  })
}

export interface ConfettiEmberConfig extends RadiateEmberConfig {
  fall: string
}

// Confetti-style burst (SalvageRevealToast, 2026-08-13, requested by the
// user — "the embers sort of burst out and then trickle downwards", as
// opposed to buildRadiateEmbers' burst-and-fade-in-place). Also used by
// MoneyBagRevealModal's own reveal (2026-08-13, same request extended to
// there too, colors unchanged). Same radial burst math as buildRadiateEmbers,
// plus a `fall` distance the
// .effect-ember-confetti CSS animation (index.css) adds on top of the
// burst's own resting dy only in its second half — every particle, however
// it initially launched, ends up drifting further down under that shared
// "gravity" term, the same way real confetti arcs over and drops regardless
// of which direction it was thrown.
export function buildConfettiEmbers(count: number, seed: number, radius = 90): ConfettiEmberConfig[] {
  const rand = mulberry32(seed)
  return Array.from({ length: count }, () => {
    const angle = rand() * Math.PI * 2
    const distance = radius * (0.5 + rand() * 0.6)
    return {
      size: 2 + Math.round(rand() * 3),
      delay: `${(rand() * 0.3).toFixed(2)}s`,
      duration: `${(1.2 + rand() * 0.7).toFixed(2)}s`,
      dx: `${(Math.cos(angle) * distance).toFixed(1)}px`,
      dy: `${(Math.sin(angle) * distance).toFixed(1)}px`,
      fall: `${(50 + rand() * 60).toFixed(1)}px`,
    }
  })
}
