export type ForgeMode = 'standard' | 'master' | 'composition' | 'salvage' | 'sockets' | 'enchant'

interface ForgeHubTile {
  mode: ForgeMode
  title: string
  description: string
  icon: string
}

// Six large tiles (2026-08-13 redesign — supersedes the old cramped
// four-button toggle row that used to sit above the Forge content, with
// Composition folded invisibly into the Forge tile's own drag-detection).
// Each tile routes into its own two-column detail panel (ForgeTwoColumnLayout)
// via ForgePanel's onSelect.
const FORGE_TILES: ForgeHubTile[] = [
  {
    mode: 'standard',
    title: 'Forge',
    description: 'Upgrade level and quality with a statistically better chance for success.',
    icon: '🔨',
  },
  {
    mode: 'master',
    title: 'Master Forge',
    description: 'Upgrade level and quality with a guaranteed cost for success.',
    icon: '⚒️',
  },
  {
    mode: 'composition',
    title: 'Composition',
    description: 'Feed stones and gear into an item for guaranteed, permanent +N stat growth.',
    icon: '💠',
  },
  {
    mode: 'salvage',
    title: 'Salvage',
    description: 'Salvage quality gear for Ascension Points.',
    icon: '♻️',
  },
  {
    mode: 'sockets',
    title: 'Sockets',
    description: "Add sockets to your gear. Gems can't be removed but can be overwritten.",
    icon: '💎',
  },
  {
    mode: 'enchant',
    title: 'Enchantress',
    description: 'Consume a Normal, Tempered, or Ascended gem to add an HP bonus to your gear.',
    icon: '✨',
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
          <span className="text-3xl">{tile.icon}</span>
          <span className="text-sm font-semibold text-slate-200">{tile.title}</span>
          <span className="text-[11px] leading-snug text-slate-500">{tile.description}</span>
        </button>
      ))}
    </div>
  )
}
