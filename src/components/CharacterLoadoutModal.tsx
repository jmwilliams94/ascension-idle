import EquipmentSlot from './EquipmentSlot'
import {
  buildGearTooltip,
  formatItemDisplayName,
  getGearIconSrc,
  getItemIcon,
  getQualityColor,
  itemHasDurability,
} from '../game/items/equipmentBonus'
import { useItemTemplatesStore, type ItemTemplate } from '../game/items/useItemTemplatesStore'
import type { ItemInstance } from '../game/items/useInventoryStore'
import { useCharacterLoadoutStore, type LoadoutItem, type LoadoutSlot } from '../game/social/useCharacterLoadoutStore'

// Same paper-doll size/grid EquipmentPanel.tsx uses (see that file's own
// comment for the layout's history) -- kept in sync deliberately so
// "inspect gear" reads as the same UI, just read-only and stats-free.
const SLOT_SIZE = 'h-16 w-16 lg:h-20 lg:w-20'

const SLOTS: { slot: LoadoutSlot; label: string; icon: string; gridArea: string }[] = [
  { slot: 'hat', label: 'Head', icon: '🪖', gridArea: 'head' },
  { slot: 'necklace', label: 'Necklace', icon: '📿', gridArea: 'neck' },
  { slot: 'ring', label: 'Ring', icon: '💍', gridArea: 'ring' },
  { slot: 'weapon', label: 'Main Hand', icon: '🗡️', gridArea: 'main' },
  { slot: 'boots', label: 'Boots', icon: '👢', gridArea: 'boots' },
  { slot: 'coat', label: 'Armor', icon: '🥋', gridArea: 'armor' },
]
// Second-hand slot — same class-dependent repurposing of the `quiver` slot
// EquipmentPanel.tsx does (see its own comment for the full rationale).
const SECOND_HAND_BY_CLASS: Partial<Record<string, { label: string; icon: string }>> = {
  hunter: { label: 'Quiver', icon: '🏹' },
  'twin-soul': { label: 'Off Hand', icon: '⚔️' },
  juggernaut: { label: 'Shield', icon: '🛡️' },
}

// Same snapshot-preview pattern as MarketplacePanel's snapshotPreviewItem /
// LootHoldingCard's previewInstanceForEntry -- a synthetic ItemInstance built
// from flat RPC fields, fed straight into buildGearTooltip. Unlike those two,
// view_character_loadout actually returns real sockets/enchant/durability, so
// this preview is more complete than either of them.
function previewLoadoutItem(loadoutItem: LoadoutItem, template: ItemTemplate): ItemInstance {
  return {
    id: loadoutItem.item_id,
    template_id: template.id,
    owner_id: '',
    quality_tier: loadoutItem.quality_tier,
    level: loadoutItem.level,
    composition_level: loadoutItem.composition_level,
    composition_points: 0,
    sockets: loadoutItem.sockets,
    enchant: loadoutItem.enchant,
    durability: loadoutItem.durability,
    created_at: '',
    location: 'inventory',
  }
}

// "Inspect other player's gear" (2026-08-19, requested by the user) --
// opened by tapping a character-name badge in Global Chat. Deliberately
// read-only: no onClick on any tile (no detail card, no Unequip), no Stats
// block -- just the same paper-doll tiles with the same hover/tap tooltips
// Equipment already has. Mounted unconditionally in GameShell, driven by
// useCharacterLoadoutStore.
export default function CharacterLoadoutModal() {
  const open = useCharacterLoadoutStore((state) => state.open)
  const close = useCharacterLoadoutStore((state) => state.close)
  const characterName = useCharacterLoadoutStore((state) => state.characterName)
  const loading = useCharacterLoadoutStore((state) => state.loading)
  const error = useCharacterLoadoutStore((state) => state.error)
  const loadout = useCharacterLoadoutStore((state) => state.loadout)
  const templates = useItemTemplatesStore((state) => state.templates)

  if (!open) {
    return null
  }

  const isHunter = loadout?.character.class === 'hunter'
  const loadoutClassId = loadout?.character.class
  const secondHandConfig = loadoutClassId ? SECOND_HAND_BY_CLASS[loadoutClassId] : undefined
  const weaponLoadoutItem = loadout?.equipment.weapon ?? null
  const weaponTemplate = weaponLoadoutItem ? templates.find((t) => t.id === weaponLoadoutItem.template_id) : undefined

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={close}>
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {loadout ? `${loadout.character.name} — Lv ${loadout.character.level}` : characterName}
          </h2>
          <button type="button" onClick={close} aria-label="Close" className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        {loading && <p className="py-6 text-center text-sm text-slate-500">Loading…</p>}
        {!loading && error && (
          <p className="py-6 text-center text-sm text-slate-500">
            {error === 'not_found' ? 'Character not found.' : 'Failed to load gear.'}
          </p>
        )}

        {!loading && loadout && (
          <div
            className="mx-auto grid max-w-xs gap-x-2 gap-y-3"
            style={{
              gridTemplateColumns: '1fr 1fr 1fr',
              gridTemplateAreas: '". head ." "neck . ring" ". armor ." "offhand . main" ". boots ."',
            }}
          >
            {[
              ...SLOTS,
              ...(secondHandConfig
                ? [{ slot: 'quiver' as LoadoutSlot, label: secondHandConfig.label, icon: secondHandConfig.icon, gridArea: 'offhand' }]
                : []),
            ].map(({ slot, label, icon, gridArea }) => {
              const loadoutItem = loadout.equipment[slot]
              const template = loadoutItem ? templates.find((t) => t.id === loadoutItem.template_id) : undefined
              const equipped = loadoutItem && template ? { item: previewLoadoutItem(loadoutItem, template), template } : null

              // Same cosmetic-only mirror EquipmentPanel does, Hunter's
              // Quiver only: its own tier is meaningless (no stats, never
              // dropped/upgraded), so its glow/tooltip color matches whatever
              // Bow is equipped. Twin-soul/Juggernaut's real second-hand gear
              // shows its own real tier.
              const glowQualityTier =
                slot === 'quiver' && isHunter ? weaponLoadoutItem?.quality_tier : equipped?.item.quality_tier

              return (
                <div key={slot} style={{ gridArea }} className="flex items-center justify-center">
                  <EquipmentSlot
                    label={
                      equipped
                        ? formatItemDisplayName(equipped.template.name, equipped.item.quality_tier, equipped.item.composition_level)
                        : `${label} — empty`
                    }
                    icon={equipped ? getItemIcon(equipped.template.slot_type) : icon}
                    iconSrc={equipped ? getGearIconSrc(equipped.template.name) : undefined}
                    filled={Boolean(equipped)}
                    qualityColor={equipped ? getQualityColor(glowQualityTier ?? 'normal') : undefined}
                    compositionLevel={equipped?.item.composition_level}
                    broken={equipped && itemHasDurability(equipped.template.slot_type) ? equipped.item.durability <= 0 : undefined}
                    tooltip={
                      equipped
                        ? buildGearTooltip(
                            slot === 'quiver' && isHunter
                              ? { ...equipped.item, quality_tier: glowQualityTier ?? 'normal' }
                              : equipped.item,
                            equipped.template,
                          )
                        : undefined
                    }
                    sizeClassName={SLOT_SIZE}
                  />
                </div>
              )
            })}

            {loadoutClassId === 'wuxia' && (
              // Same decorative dimmed echo of Main Hand EquipmentPanel.tsx
              // renders for a live Wuxia character — see its comment.
              <div style={{ gridArea: 'offhand' }} className="flex items-center justify-center opacity-40">
                <EquipmentSlot
                  label="Off Hand"
                  icon={weaponTemplate ? getItemIcon(weaponTemplate.slot_type) : '⚔️'}
                  iconSrc={weaponTemplate ? getGearIconSrc(weaponTemplate.name) : undefined}
                  filled={Boolean(weaponLoadoutItem)}
                  qualityColor={weaponLoadoutItem ? getQualityColor(weaponLoadoutItem.quality_tier) : undefined}
                  sizeClassName={SLOT_SIZE}
                />
              </div>
            )}

            {!secondHandConfig && loadoutClassId !== 'wuxia' && (
              <div style={{ gridArea: 'offhand' }} className="flex items-center justify-center">
                <EquipmentSlot label="Off-hand / Shield" icon="🛡️" locked sizeClassName={SLOT_SIZE} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
