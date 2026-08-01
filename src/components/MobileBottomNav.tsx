import { useCombatStore } from '../game/combat/useCombatStore'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { getWeaponIcon } from '../game/items/equipmentBonus'
import { useTabStore, type TabId } from '../game/hud/useTabStore'

const BASE_URL = import.meta.env.BASE_URL

// Fixed bottom nav bar, mobile-only (`lg:hidden` — desktop keeps TabNav.tsx
// unchanged, now `hidden lg:grid`) — confirmed with the user, 2026-08-02, as
// a full replacement for TabNav's own mobile rendering, not a variant of it.
// 7 buttons, one per tab (confirmed: all existing tabs stay a single tap
// away, nothing tucked behind a "More" menu), Combat centered as "Fight"/
// "Idle" — confirmed navigation-only, same as every other button here; it
// does NOT itself start/stop combat (that's still Combat's own Fight/Stop
// button, already built for mobile — see CombatPage.tsx). The label just
// reflects `isFighting` so the bar itself hints at your current state
// without requiring a trip to the Combat page to check.
//
// Grouping either side of center is arbitrary (no design reason to split any
// particular way) — kept in TabNav's own existing left-to-right order, split
// around Combat: Equipment/Forge/Market before it, Shop/Bank/
// Achievements after.
//
// Equipment/Forge/Shop/Bank/Achievements all use real icon art now
// (public/nav-icons/, supplied 2026-08-02); Market stays emoji since no art
// exists for it yet.
type NavIcon = { kind: 'emoji'; value: string } | { kind: 'image'; src: string; alt: string }

const LEFT_ITEMS: { id: TabId; label: string; icon: NavIcon }[] = [
  { id: 'equipment', label: 'Equip', icon: { kind: 'image', src: `${BASE_URL}nav-icons/equipment.png`, alt: 'Equipment' } },
  { id: 'forge', label: 'Forge', icon: { kind: 'image', src: `${BASE_URL}nav-icons/forge.png`, alt: 'Forge' } },
  { id: 'marketplace', label: 'Market', icon: { kind: 'emoji', value: '🤝' } },
]

const RIGHT_ITEMS: { id: TabId; label: string; icon: NavIcon }[] = [
  { id: 'shop', label: 'Shop', icon: { kind: 'image', src: `${BASE_URL}nav-icons/shop.png`, alt: 'Shop' } },
  { id: 'warehouse', label: 'Bank', icon: { kind: 'image', src: `${BASE_URL}nav-icons/bank.png`, alt: 'Bank' } },
  { id: 'achievements', label: 'Achiev.', icon: { kind: 'image', src: `${BASE_URL}nav-icons/achievements.png`, alt: 'Achievements' } },
]

function NavIconGlyph({ icon }: { icon: NavIcon }) {
  if (icon.kind === 'image') {
    return <img src={icon.src} alt={icon.alt} className="h-6 w-6 object-contain" />
  }
  return <span className="text-lg">{icon.value}</span>
}

function NavButton({ id, label, icon }: { id: TabId; label: string; icon: NavIcon }) {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const active = activeTab === id

  return (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium leading-tight ${
        active ? 'text-sky-300' : 'text-slate-400'
      }`}
    >
      <NavIconGlyph icon={icon} />
      <span className="truncate">{label}</span>
    </button>
  )
}

// Reflects whatever's actually equipped in the Main Hand slot (confirmed with
// the user, 2026-08-02) rather than a fixed ⚔️ — resolves equippedIds.weapon
// through the owned item's template to its item_family, then to an emoji via
// getWeaponIcon (see equipmentBonus.ts; no per-weapon art exists yet, so this
// is the pragmatic "dynamic" implementation). Falls back to the generic ⚔️
// when no weapon is equipped at all (e.g. a fresh non-Hunter character).
function useEquippedWeaponIcon(): string {
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

function FightNavButton() {
  const activeTab = useTabStore((state) => state.activeTab)
  const setActiveTab = useTabStore((state) => state.setActiveTab)
  const isFighting = useCombatStore((state) => state.isFighting)
  const active = activeTab === 'combat'
  const weaponIcon = useEquippedWeaponIcon()

  return (
    <button
      type="button"
      onClick={() => setActiveTab('combat')}
      className="flex flex-1 flex-col items-center justify-center gap-0.5"
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full border-2 text-lg shadow-lg ${
          isFighting
            ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 shadow-emerald-500/20'
            : active
              ? 'border-sky-400 bg-sky-500/20 text-sky-300 shadow-sky-500/20'
              : 'border-slate-600 bg-slate-800 text-slate-300 shadow-black/30'
        }`}
      >
        {weaponIcon}
      </span>
      <span className={`text-[10px] font-semibold leading-tight ${isFighting ? 'text-emerald-300' : 'text-slate-400'}`}>
        {isFighting ? 'Fighting' : 'Idle'}
      </span>
    </button>
  )
}

export default function MobileBottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800/80 bg-slate-950/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-md items-stretch px-1">
        {LEFT_ITEMS.map((item) => (
          <NavButton key={item.id} {...item} />
        ))}
        <FightNavButton />
        {RIGHT_ITEMS.map((item) => (
          <NavButton key={item.id} {...item} />
        ))}
      </div>
    </nav>
  )
}
