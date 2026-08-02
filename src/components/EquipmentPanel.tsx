import { useState } from 'react'
import EquipmentSlot from './EquipmentSlot'
import {
  buildGearTooltip,
  formatBaseStats,
  formatItemDisplayName,
  formatItemLevel,
  getGearIconSrc,
  getItemIcon,
  getQualityColor,
} from '../game/items/equipmentBonus'
import { useEquipmentStore, type EquipSlot } from '../game/items/useEquipmentStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../game/items/useItemTemplatesStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'

// Slot size for this paper-doll — scaled up from the default h-16 w-16 now that
// there's no central character placeholder competing for room (see below).
// Responsive: the fixed 96px size didn't shrink to fit the percentage-based
// grid columns below (`gridTemplateColumns: '30% 40% 30%'` inside a max-w-sm
// container), which get tight enough on a phone that a 96px tile would
// overflow its own column — same fixed-size-tile pattern that broke the
// Inventory grid before. Unchanged 96px at `lg`+.
const SLOT_SIZE = 'h-16 w-16 lg:h-24 lg:w-24'

// Multi-slot equipping (confirmed, 2026-07-31 — supersedes the earlier
// "only Main Hand is functional" version). Matches the 6 slot_types that
// actually have catalog data; Off-hand/Shield stays a locked placeholder for
// every class except Hunter, who gets a functional Quiver there instead (see
// below) — no shield item_family exists at all.
const SLOTS: { slot: EquipSlot; label: string; icon: string; gridArea: string }[] = [
  { slot: 'hat', label: 'Head', icon: '🪖', gridArea: 'head' },
  { slot: 'necklace', label: 'Necklace', icon: '📿', gridArea: 'neck' },
  { slot: 'ring', label: 'Ring', icon: '💍', gridArea: 'ring' },
  { slot: 'weapon', label: 'Main Hand', icon: '🗡️', gridArea: 'main' },
  { slot: 'boots', label: 'Boots', icon: '👢', gridArea: 'boots' },
  { slot: 'coat', label: 'Armor', icon: '🥋', gridArea: 'armor' },
]

const QUIVER_SLOT_CONFIG = { slot: 'quiver' as EquipSlot, label: 'Quiver', icon: '🏹', gridArea: 'offhand' }

// Paper-doll layout. Right column, top to bottom: Head, Necklace, Ring, Main
// Hand. Bottom row lines up Boots (left), Off-hand/Shield (center), and Armor
// (right, below Main Hand). Off-hand/Shield is the one remaining non-clickable,
// greyed-out placeholder — no shield item_family exists in the catalog at all
// (see CLAUDE.md's Gear slots note).
//
// The central character placeholder (PaperDollBody, an abstract/geometric
// segmented rectangle) has been removed — CLAUDE.md flagged its fate as an
// open decision ("keep the abstract box... or design a real static per-class
// portrait... Not decided yet"); the decision is now to drop it rather than
// replace it, freeing room to grow the remaining slot tiles instead.
export default function EquipmentPanel() {
  const equippedIds = useEquipmentStore((state) => state.equippedIds)
  const setEquippedItem = useEquipmentStore((state) => state.setEquippedItem)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const isHunter = selectedClassId === 'hunter'

  const [selectedSlot, setSelectedSlot] = useState<EquipSlot | null>(null)

  const findEquipped = (slot: EquipSlot): { item: ItemInstance; template: ItemTemplate } | null => {
    const itemId = equippedIds[slot]
    const item = itemId ? items.find((entry) => entry.id === itemId) : undefined
    const template = item && templates.find((entry) => entry.id === item.template_id)
    return item && template ? { item, template } : null
  }

  const selected = selectedSlot ? findEquipped(selectedSlot) : null

  return (
    <div className="space-y-4">
      <div
        className="mx-auto grid max-w-sm gap-2 lg:gap-3"
        style={{
          gridTemplateColumns: '30% 40% 30%',
          gridTemplateAreas: '". . head" ". . neck" ". . ring" ". . main" "boots offhand armor"',
        }}
      >
        {[...SLOTS, ...(isHunter ? [QUIVER_SLOT_CONFIG] : [])].map(({ slot, label, icon, gridArea }) => {
          const equipped = findEquipped(slot)

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
                qualityColor={equipped ? getQualityColor(equipped.item.quality_tier) : undefined}
                selected={selectedSlot === slot}
                onClick={equipped ? () => setSelectedSlot((current) => (current === slot ? null : slot)) : undefined}
                tooltip={equipped ? buildGearTooltip(equipped.item, equipped.template) : undefined}
                sizeClassName={SLOT_SIZE}
              />
            </div>
          )
        })}

        {!isHunter && (
          <div style={{ gridArea: 'offhand' }} className="flex items-center justify-center">
            <EquipmentSlot label="Off-hand / Shield" icon="🛡️" locked sizeClassName={SLOT_SIZE} />
          </div>
        )}
      </div>

      {selected && selectedSlot && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-lg"
              style={{ borderColor: getQualityColor(selected.item.quality_tier) }}
            >
              {getGearIconSrc(selected.template.name) ? (
                <img src={getGearIconSrc(selected.template.name)} alt="" className="h-3/5 w-3/5 object-contain" />
              ) : (
                getItemIcon(selected.template.slot_type)
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {formatItemDisplayName(selected.template.name, selected.item.quality_tier, selected.item.composition_level)}
              </p>
              <p className="text-xs text-slate-500">{formatItemLevel(selected.item.level)}</p>
              <p className="text-xs text-slate-500">{formatBaseStats(selected.template.base_stats, selected.item.quality_tier)}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setEquippedItem(selectedSlot, null)
              setSelectedSlot(null)
            }}
            className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500"
          >
            Unequip
          </button>
        </div>
      )}

      {!selected && <p className="text-center text-xs text-slate-500">Equip gear from your Inventory to fill these slots.</p>}
    </div>
  )
}
