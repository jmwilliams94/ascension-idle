import { useState } from 'react'
import EquipmentSlot from './EquipmentSlot'
import { buildGearTooltip, formatBaseStats, formatItemDisplayName, formatQualityAndLevel, getQualityColor } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

// Slot size for this paper-doll — scaled up from the default h-16 w-16 now that
// there's no central character placeholder competing for room (see below).
const SLOT_SIZE = 'h-24 w-24'

// Paper-doll layout. Right column, top to bottom: Head, Necklace, Ring, Main
// Hand — the only functional slot this step, matching equipped_item_id's
// current single-slot shortcut. Bottom row lines up Boots (left), Off-hand/
// Shield (center), and Armor (right, below Main Hand). Everything except Main
// Hand is a non-clickable, greyed-out placeholder hinting at a future gear type
// via a faint icon, since those slots don't exist in the schema yet (see
// CLAUDE.md's Gear slots note — exact per-class slot assignment is still
// unresolved, these are illustrative, not final).
//
// The central character placeholder (PaperDollBody, an abstract/geometric
// segmented rectangle) has been removed — CLAUDE.md flagged its fate as an
// open decision ("keep the abstract box... or design a real static per-class
// portrait... Not decided yet"); the decision is now to drop it rather than
// replace it, freeing room to grow the remaining slot tiles instead.
export default function EquipmentPanel() {
  const equippedItemId = useEquipmentStore((state) => state.equippedItemId)
  const setEquippedItemId = useEquipmentStore((state) => state.setEquippedItemId)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)

  const [weaponSelected, setWeaponSelected] = useState(false)

  const equippedItem = items.find((entry) => entry.id === equippedItemId)
  const template = equippedItem && templates.find((entry) => entry.id === equippedItem.template_id)

  return (
    <div className="space-y-4">
      <div
        className="mx-auto grid max-w-sm gap-3"
        style={{
          gridTemplateColumns: '30% 40% 30%',
          gridTemplateAreas: '". . head" ". . neck" ". . ring" ". . main" "boots offhand armor"',
        }}
      >
        <div style={{ gridArea: 'head' }} className="flex items-center justify-center">
          <EquipmentSlot label="Head" icon="🪖" locked sizeClassName={SLOT_SIZE} />
        </div>
        <div style={{ gridArea: 'neck' }} className="flex items-center justify-center">
          <EquipmentSlot label="Necklace" icon="📿" locked sizeClassName={SLOT_SIZE} />
        </div>
        <div style={{ gridArea: 'ring' }} className="flex items-center justify-center">
          <EquipmentSlot label="Ring" icon="💍" locked sizeClassName={SLOT_SIZE} />
        </div>

        <div style={{ gridArea: 'main' }} className="flex items-center justify-center">
          <EquipmentSlot
            label={template ? formatItemDisplayName(template.name, equippedItem.quality_tier, equippedItem.composition_level) : 'Main Hand — empty'}
            icon={template ? '🗡️' : undefined}
            filled={Boolean(template)}
            qualityColor={equippedItem ? getQualityColor(equippedItem.quality_tier) : undefined}
            selected={weaponSelected}
            onClick={template ? () => setWeaponSelected((current) => !current) : undefined}
            tooltip={equippedItem ? buildGearTooltip(equippedItem, template || undefined) : undefined}
            sizeClassName={SLOT_SIZE}
          />
        </div>

        <div style={{ gridArea: 'boots' }} className="flex items-center justify-center">
          <EquipmentSlot label="Boots" icon="👢" locked sizeClassName={SLOT_SIZE} />
        </div>
        <div style={{ gridArea: 'offhand' }} className="flex items-center justify-center">
          <EquipmentSlot label="Off-hand / Shield" icon="🛡️" locked sizeClassName={SLOT_SIZE} />
        </div>
        <div style={{ gridArea: 'armor' }} className="flex items-center justify-center">
          <EquipmentSlot label="Armor" icon="🥋" locked sizeClassName={SLOT_SIZE} />
        </div>
      </div>

      {weaponSelected && equippedItem && template && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-lg"
              style={{ borderColor: getQualityColor(equippedItem.quality_tier) }}
            >
              🗡️
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {formatItemDisplayName(template.name, equippedItem.quality_tier, equippedItem.composition_level)}
              </p>
              <p className="text-xs text-slate-500">{formatQualityAndLevel(equippedItem.quality_tier, equippedItem.level)}</p>
              <p className="text-xs text-slate-500">{formatBaseStats(template.base_stats)}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setEquippedItemId(null)
              setWeaponSelected(false)
            }}
            className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500"
          >
            Unequip
          </button>
        </div>
      )}

      {!template && <p className="text-center text-xs text-slate-500">Equip a weapon from your Inventory to fill this slot.</p>}
    </div>
  )
}
