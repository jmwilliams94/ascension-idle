import { useMemo, type CSSProperties } from 'react'
import { buildRadiateEmbers } from './tierEffectsData'

// The radiating-ember tile effect — confirmed 2026-08-02 after many rounds
// of user iteration in a Settings-tab gallery (ItemEffectGallery.tsx, still
// used as a live preview of exactly this component, not a separate copy).
// Wired into InventorySlot.tsx, the single shared tile renderer behind
// every real gear/material tile in the game (Inventory grid, Forge's
// Upgrade/Material slots, Equipment paper doll, Bank Storage, Loot
// Holding) — so this file is the one place that needs updating if the
// look ever changes. See tierEffectsData.ts for the density table (which
// colors get the effect and how dense) and the ember-layout math.
//
// Applies to two categories, both keyed by a tile's own already-established
// `qualityColor` hex value (not a separate "tier" enum) so there's exactly
// one source of truth per color, matching however that color is already
// used for a tile's border/background tint:
//   1. Gear quality tiers above Normal (see QUALITY_COLORS in
//      equipmentBonus.ts) — Normal is deliberately absent, so it renders no
//      effect at all, per the user's "that one shouldn't have any."
//   2. The established "rare material" colors (see forgeCosts.ts) —
//      MATERIAL_COLOR (Comet, Composition Stones) and FALLEN_STAR_COLOR.
//      CONSUMABLE_COLOR (Potions) is deliberately absent — potions aren't
//      "rare" in the same sense.

interface RadiateStyle extends CSSProperties {
  '--ember-dx': string
  '--ember-dy': string
}

// The full effect: a brighter, breathing core glow (effect-core-pulse) plus
// the radiating embers themselves (effect-ember-radiate) — both defined in
// index.css. Renders nothing at all when count <= 0 (e.g. Normal quality),
// so callers can render this unconditionally without their own extra guard.
export function TierEmberEffect({ color, count, seed, radius }: { color: string; count: number; seed: number; radius?: number }) {
  const embers = useMemo(() => buildRadiateEmbers(count, seed, radius), [count, seed, radius])

  if (count <= 0) {
    return null
  }

  return (
    <>
      <div
        className="effect-core-pulse absolute inset-0"
        style={{ background: `radial-gradient(circle, ${color}80 0%, ${color}38 40%, transparent 75%)` }}
      />
      {embers.map((ember, i) => {
        const style: RadiateStyle = {
          left: '50%',
          top: '50%',
          width: `${ember.size}px`,
          height: `${ember.size}px`,
          backgroundColor: color,
          boxShadow: `0 0 ${ember.size + 3}px ${Math.max(1, ember.size - 1)}px ${color}cc`,
          animationDelay: ember.delay,
          animationDuration: ember.duration,
          '--ember-dx': ember.dx,
          '--ember-dy': ember.dy,
        }
        return <span key={i} className="effect-ember-radiate absolute rounded-full" style={style} />
      })}
    </>
  )
}
