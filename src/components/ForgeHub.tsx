export type ForgeMode = 'standard' | 'master' | 'composition' | 'salvage' | 'sockets' | 'enchant'

interface ForgeHubTile {
  mode: ForgeMode
  title: string
  description: string
  iconSrc: string
  // Overrides the default h-14 w-14 icon box below — only Composition uses
  // this (the +9 Composition Stone art reads visually larger than the other
  // five icons at the same box size, per the user's request to shrink it
  // ~15%).
  iconClassName?: string
}

// Six large tiles (2026-08-13 redesign — supersedes the old cramped
// four-button toggle row that used to sit above the Forge content, with
// Composition folded invisibly into the Forge tile's own drag-detection).
// Each tile routes into its own two-column detail panel (ForgeTwoColumnLayout)
// via ForgePanel's onSelect.
//
// Real icon art (2026-08-13) replaces the original emoji placeholders.
// Master Forge/Enchant/Salvage are dedicated tile art (public/forge-icons/);
// Forge reuses the existing bottom-nav forge icon; Composition/Sockets reuse
// existing item icons (a +9 Composition Stone, an Ascended Drake Gem) rather
// than new dedicated art — plain <img> tiles here, not wrapped in the
// InventorySlot quality-tint/ember-glow treatment those icons normally get.
const FORGE_TILES: ForgeHubTile[] = [
  {
    mode: 'standard',
    title: 'Forge',
    description: 'Upgrade level and quality with a statistically better chance for success.',
    iconSrc: `${import.meta.env.BASE_URL}nav-icons/forge.png`,
  },
  {
    mode: 'master',
    title: 'Master Forge',
    description: 'Upgrade level and quality with a guaranteed cost for success.',
    iconSrc: `${import.meta.env.BASE_URL}forge-icons/master-forge.png`,
  },
  {
    mode: 'composition',
    title: 'Composition',
    description: 'Feed stones and gear into an item for guaranteed, permanent +N stat growth.',
    iconSrc: `${import.meta.env.BASE_URL}item-icons/composition-stone-9.png`,
    iconClassName: 'h-12 w-12',
  },
  {
    mode: 'salvage',
    title: 'Salvage',
    description: 'Salvage quality gear for Ascension Points.',
    iconSrc: `${import.meta.env.BASE_URL}forge-icons/salvage.png`,
  },
  {
    mode: 'sockets',
    title: 'Sockets',
    description: "Add sockets to your gear. Gems can't be removed but can be overwritten.",
    iconSrc: `${import.meta.env.BASE_URL}item-icons/gem-drake-ascended.png`,
  },
  {
    mode: 'enchant',
    title: 'Enchantress',
    description: 'Consume a Normal, Tempered, or Ascended gem to add an HP bonus to your gear.',
    iconSrc: `${import.meta.env.BASE_URL}forge-icons/enchant.png`,
  },
]

interface ForgeHubProps {
  onSelect: (mode: ForgeMode) => void
}

export default function ForgeHub({ onSelect }: ForgeHubProps) {
  return (
    <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
      {FORGE_TILES.map((tile) => (
        <button
          key={tile.mode}
          type="button"
          onClick={() => onSelect(tile.mode)}
          className="flex min-h-40 flex-col items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-5 text-center transition-colors hover:border-amber-600/60 hover:bg-slate-900"
        >
          <img src={tile.iconSrc} alt="" className={`${tile.iconClassName ?? 'h-14 w-14'} object-contain`} />
          <span className="text-sm font-semibold text-slate-200">{tile.title}</span>
          <span className="text-[11px] leading-snug text-slate-500">{tile.description}</span>
        </button>
      ))}
    </div>
  )
}
