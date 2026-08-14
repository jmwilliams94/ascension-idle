import type { TabId } from './useTabStore'

// Shared between MobileBottomNav.tsx and TabNav.tsx (2026-08-03) — both bars
// need to show the exact same tab icons, so this is real business-logic
// duplication risk (which nav-icon path maps to which tab), not just
// similar-shaped UI — worth sharing, unlike this codebase's usual "small
// deliberate duplication" precedent for structurally-different-but-similar-
// looking components.
export type NavIcon = { kind: 'emoji'; value: string } | { kind: 'image'; src: string; alt: string }

const BASE_URL = import.meta.env.BASE_URL

export const TAB_ICONS: Partial<Record<TabId, NavIcon>> = {
  // Static hourglass (2026-08-14) — replaced the old dynamic equipped-weapon
  // icon + live "Fighting"/"Idle" status text; both bars now always read
  // "Idling", matching GameShell's page-heading rename.
  combat: { kind: 'image', src: `${BASE_URL}nav-icons/idling.png`, alt: 'Idling' },
  equipment: { kind: 'image', src: `${BASE_URL}nav-icons/equipment.png`, alt: 'Equipment' },
  lucky: { kind: 'image', src: `${BASE_URL}lucky-icons/luckylad.png`, alt: 'LuckyLad' },
  forge: { kind: 'image', src: `${BASE_URL}nav-icons/forge.png`, alt: 'Forge' },
  // No real art exists for Market yet — a deliberately mixed icon language
  // until more art arrives, not an inconsistency to "fix" by reverting the
  // ones that already have real art.
  marketplace: { kind: 'emoji', value: '🤝' },
  shop: { kind: 'image', src: `${BASE_URL}nav-icons/shop.png`, alt: 'Shop' },
  bank: { kind: 'image', src: `${BASE_URL}nav-icons/bank.png`, alt: 'Bank' },
  achievements: { kind: 'image', src: `${BASE_URL}nav-icons/achievements.png`, alt: 'Achievements' },
}
