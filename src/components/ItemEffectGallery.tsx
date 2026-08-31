import type { CSSProperties } from 'react'
import { TierEmberEffect } from '../game/items/tierEffects'
import { EMBER_DENSITY_BY_COLOR, emberCountForColor, seedFromId } from '../game/items/tierEffectsData'

// Confirmed 2026-08-02: the radiating-ember effect (tierEffects.tsx) is now
// live on every real gear/material tile in the game via InventorySlot —
// this page just previews it using the exact same component/density table,
// not a separate copy, so it can never drift from what's actually shown.
// (Earlier exploratory rounds — web/lightning line-art, ember clouds, a
// foil sweep, a rising-from-bottom variant — were tried and dropped; see
// git history if any are worth revisiting.)
//
// The tile frame itself (.item-quality-frame/.item-quality-frame-inner,
// index.css) is the same rounded gradient-border technique InventorySlot/
// EquipmentSlot/dragDrop's ghost tile use for real — design-reviewed here
// against the old flat border before it shipped app-wide (2026-09-01), now
// just a live preview like the ember effect above it, not a separate copy.
//
// Gems aren't implemented as real items yet (see CLAUDE.md's Gem system
// section), so there's nothing to preview for them here — but confirmed
// with the user: once built, Gems use a 3-tier ladder (Normal -> Tempered
// -> Ascended, skipping Infused/Radiant), reusing this same density table
// (Tempered = 5, Ascended = 100). Gem colors themselves aren't decided yet.

interface Example {
  label: string
  caption: string
  // Undefined for Normal, same as InventorySlot never passing a qualityColor
  // for it — the frame's CSS default (a neutral steel gray) applies instead
  // of a real quality-tier color, matching what a real Normal-quality tile
  // actually renders.
  color?: string
}

const EXAMPLES: Example[] = [
  { label: 'Normal', caption: 'No effect', color: undefined },
  { label: 'Tempered', caption: '5 embers', color: '#4FC3F7' },
  { label: 'Infused', caption: '10 embers', color: '#2E5EAA' },
  { label: 'Radiant', caption: '25 embers', color: '#A855F7' },
  { label: 'Ascended', caption: '100 embers', color: '#EF4444' },
  { label: 'Comet / Stones', caption: '10 embers (rare material)', color: '#C8D0DC' },
  { label: 'Fallen Star', caption: '10 embers (rare material)', color: '#F0B87A' },
]

interface FrameTileStyle extends CSSProperties {
  '--item-tier-color'?: string
}

function ExampleTile({ example, index }: { example: Example; index: number }) {
  const count = emberCountForColor(example.color)
  const style: FrameTileStyle = example.color ? { '--item-tier-color': example.color } : {}

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="item-quality-frame h-24 w-24 shrink-0" style={style}>
        <div className="item-quality-frame-inner relative flex h-full w-full items-center justify-center overflow-hidden text-xl">
          <TierEmberEffect color={example.color ?? '#94a3b8'} count={count} seed={seedFromId(`gallery-${index}`)} />
          <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">🗡️</span>
        </div>
      </div>
      <p className="text-[11px] font-medium text-slate-300">{example.label}</p>
      <p className="text-[10px] leading-snug text-slate-500">{example.caption}</p>
    </div>
  )
}

export default function ItemEffectGallery() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Live on every real gear/material tile in the game now (Inventory, Forge, Equipment, Bank, Loot Holding) — colored
        to match each tile's own established color ({Object.keys(EMBER_DENSITY_BY_COLOR).length} colors mapped: 4 gear quality
        tiers + Comet/Stones + Fallen Star), denser for rarer/more valuable tiles. Normal quality and Potions get no effect at
        all. Every tile is actually animated; a screenshot won't show the motion.
      </p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {EXAMPLES.map((example, index) => (
          <ExampleTile key={example.label} example={example} index={index} />
        ))}
      </div>
    </div>
  )
}
