import { TierEmberEffect } from '../game/items/tierEffects'
import { EMBER_DENSITY_BY_COLOR, emberCountForColor, seedFromId } from '../game/items/tierEffectsData'
import { useFireworkTestStore } from '../game/items/useFireworkTestStore'

// Confirmed 2026-08-02: the radiating-ember effect (tierEffects.tsx) is now
// live on every real gear/material tile in the game via InventorySlot —
// this page just previews it using the exact same component/density table,
// not a separate copy, so it can never drift from what's actually shown.
// (Earlier exploratory rounds — web/lightning line-art, ember clouds, a
// foil sweep, a rising-from-bottom variant — were tried and dropped; see
// git history if any are worth revisiting.)
//
// Gems aren't implemented as real items yet (see CLAUDE.md's Gem system
// section), so there's nothing to preview for them here — but confirmed
// with the user: once built, Gems use a 3-tier ladder (Normal -> Tempered
// -> Ascended, skipping Infused/Radiant), reusing this same density table
// (Tempered = 5, Ascended = 100). Gem colors themselves aren't decided yet.

interface Example {
  label: string
  caption: string
  color: string
}

const EXAMPLES: Example[] = [
  { label: 'Normal', caption: 'No effect', color: '#FFFFFF' },
  { label: 'Tempered', caption: '5 embers', color: '#4FC3F7' },
  { label: 'Infused', caption: '10 embers', color: '#2E5EAA' },
  { label: 'Radiant', caption: '25 embers', color: '#A855F7' },
  { label: 'Ascended', caption: '100 embers', color: '#EF4444' },
  { label: 'Comet / Stones', caption: '10 embers (rare material)', color: '#C8D0DC' },
  { label: 'Fallen Star', caption: '10 embers (rare material)', color: '#F0B87A' },
]

function ExampleTile({ example, index }: { example: Example; index: number }) {
  const count = emberCountForColor(example.color)

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div
        className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 bg-slate-900 text-xl"
        style={{ borderColor: example.color }}
      >
        <TierEmberEffect color={example.color} count={count} seed={seedFromId(`gallery-${index}`)} />
        <span className="relative z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">🗡️</span>
      </div>
      <p className="text-[11px] font-medium text-slate-300">{example.label}</p>
      <p className="text-[10px] leading-snug text-slate-500">{example.caption}</p>
    </div>
  )
}

export default function ItemEffectGallery() {
  const fireFirework = useFireworkTestStore((state) => state.fire)

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

      <div className="border-t border-slate-800 pt-4">
        <p className="mb-2 text-xs text-slate-500">
          Full-screen preview using the same confetti-burst embers as the Money Bag/Salvage reveals, scattered across the
          whole screen in every quality color plus Comet/Stones and Fallen Star.
        </p>
        <button
          type="button"
          onClick={fireFirework}
          className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
        >
          🎆 Test Full-Screen Firework
        </button>
      </div>
    </div>
  )
}
