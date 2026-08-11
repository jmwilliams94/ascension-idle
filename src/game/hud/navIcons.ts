import { useEquipmentStore } from '../items/useEquipmentStore'
import { useInventoryStore } from '../items/useInventoryStore'
import { useItemTemplatesStore } from '../items/useItemTemplatesStore'
import { getWeaponIcon } from '../items/equipmentBonus'
import type { TabId } from './useTabStore'

// Shared between MobileBottomNav.tsx and TabNav.tsx (2026-08-03) — both bars
// need to show the exact same 8 tab icons and the exact same dynamic
// equipped-weapon icon for Combat, so this is real business-logic
// duplication risk (which nav-icon path maps to which tab, and how the
// weapon icon is derived), not just similar-shaped UI — worth sharing,
// unlike this codebase's usual "small deliberate duplication" precedent for
// structurally-different-but-similar-looking components.
export type NavIcon = { kind: 'emoji'; value: string } | { kind: 'image'; src: string; alt: string }

const BASE_URL = import.meta.env.BASE_URL

// Combat has no entry here — both bars give it its own special dynamic
// weapon-icon treatment (see useEquippedWeaponIcon below) instead of a
// static icon.
export const TAB_ICONS: Partial<Record<TabId, NavIcon>> = {
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

// Reflects whatever's actually equipped in the Main Hand slot (confirmed
// with the user, 2026-08-02) rather than a fixed ⚔️ — resolves
// equippedIds.weapon through the owned item's template to its item_family,
// then to an emoji via getWeaponIcon (no per-weapon art exists yet, so this
// is the pragmatic "dynamic" implementation). Falls back to the generic ⚔️
// when no weapon is equipped at all (e.g. a fresh non-Hunter character).
export function useEquippedWeaponIcon(): string {
  const weaponId = useEquipmentStore((state) => state.equippedIds.weapon)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)

  if (!weaponId) {
    return '⚔️'
  }

  const item = items.find((candidate) => candidate.id === weaponId)
  const template = item ? templates.find((candidate) => candidate.id === item.template_id) : undefined
  return template ? getWeaponIcon(template.item_family) : '⚔️'
}
