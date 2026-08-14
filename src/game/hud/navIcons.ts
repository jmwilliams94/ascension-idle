import { APP_VERSION } from '../../version'
import type { TabId } from './useTabStore'

// Shared between MobileBottomNav.tsx and TabNav.tsx (2026-08-03) — both bars
// need to show the exact same tab icons, so this is real business-logic
// duplication risk (which nav-icon path maps to which tab), not just
// similar-shaped UI — worth sharing, unlike this codebase's usual "small
// deliberate duplication" precedent for structurally-different-but-similar-
// looking components.
export type NavIcon = { kind: 'emoji'; value: string } | { kind: 'image'; src: string; alt: string }

const BASE_URL = import.meta.env.BASE_URL

// `?v=${APP_VERSION}` cache-busts these (2026-08-14, reported by the user:
// GitHub Pages/Cloudflare serves public/ assets with a 4h Cache-Control,
// and unlike hashed src/assets imports, files under public/ keep a fixed
// filename across builds — overwriting equipment.png/luckylad.png/
// achievements.png in place left already-cached players stuck on the old
// art until that cache expired or they hard-refreshed. A brand-new
// filename like idling.png/tavern.png never has this problem, since
// there's nothing stale to have cached — but reused filenames need an
// explicit cache-buster since we can't set per-path Cache-Control on
// GitHub Pages.
function iconUrl(path: string): string {
  return `${BASE_URL}${path}?v=${APP_VERSION}`
}

export const TAB_ICONS: Partial<Record<TabId, NavIcon>> = {
  // Static hourglass (2026-08-14) — replaced the old dynamic equipped-weapon
  // icon + live "Fighting"/"Idle" status text; both bars now always read
  // "Idling", matching GameShell's page-heading rename.
  combat: { kind: 'image', src: iconUrl('nav-icons/idling.png'), alt: 'Idling' },
  equipment: { kind: 'image', src: iconUrl('nav-icons/equipment.png'), alt: 'Equipment' },
  lucky: { kind: 'image', src: iconUrl('lucky-icons/luckylad.png'), alt: 'LuckyLad' },
  forge: { kind: 'image', src: iconUrl('nav-icons/forge.png'), alt: 'Forge' },
  // Real art (2026-08-14, scale weighing gold vs. a comet shard) replacing
  // the old 🤝 emoji placeholder.
  marketplace: { kind: 'image', src: iconUrl('nav-icons/marketplace.png'), alt: 'Market' },
  shop: { kind: 'image', src: iconUrl('nav-icons/shop.png'), alt: 'Shop' },
  bank: { kind: 'image', src: iconUrl('nav-icons/bank.png'), alt: 'Bank' },
  achievements: { kind: 'image', src: iconUrl('nav-icons/achievements.png'), alt: 'Achievements' },
}
