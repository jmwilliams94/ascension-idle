import { useState } from 'react'
import EquipmentSlot from './EquipmentSlot'
import { formatBaseStats, formatItemDisplayName, formatQualityAndLevel, getQualityColor } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

// Paper-doll layout, positioned around a central character placeholder (no art yet
// — a plain silhouette box). Right column, top to bottom: Head, Necklace, Ring,
// Main Hand — the only functional slot this step, matching equipped_item_id's
// current single-slot shortcut. Bottom row lines up Boots (left), Off-hand/Shield
// (center, below the character), and Armor (right, below Main Hand). Everything
// except Main Hand is a non-clickable, greyed-out placeholder hinting at a future
// gear type via a faint icon, since those slots don't exist in the schema yet (see
// CLAUDE.md's Gear slots note — exact per-class slot assignment is still
// unresolved, these are illustrative, not final).
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
        className="mx-auto grid max-w-xs gap-2"
        style={{
          gridTemplateColumns: '30% 40% 30%',
          gridTemplateAreas:
            '". character head" ". character neck" ". character ring" ". character main" "boots offhand armor"',
        }}
      >
        <div style={{ gridArea: 'head' }} className="flex items-center justify-center">
          <EquipmentSlot label="Head" icon="🪖" locked />
        </div>
        <div style={{ gridArea: 'neck' }} className="flex items-center justify-center">
          <EquipmentSlot label="Necklace" icon="📿" locked />
        </div>
        <div style={{ gridArea: 'ring' }} className="flex items-center justify-center">
          <EquipmentSlot label="Ring" icon="💍" locked />
        </div>

        <div style={{ gridArea: 'character' }} className="flex items-center justify-center">
          <div className="flex h-28 w-20 items-center justify-center rounded-2xl border-2 border-slate-700 bg-slate-800/60 text-4xl text-slate-600">
            🧍
          </div>
        </div>

        <div style={{ gridArea: 'main' }} className="flex items-center justify-center">
          <EquipmentSlot
            label={template ? formatItemDisplayName(template.name, equippedItem.quality_tier) : 'Main Hand — empty'}
            icon={template ? '🗡️' : undefined}
            filled={Boolean(template)}
            qualityColor={equippedItem ? getQualityColor(equippedItem.quality_tier) : undefined}
            selected={weaponSelected}
            onClick={template ? () => setWeaponSelected((current) => !current) : undefined}
          />
        </div>

        <div style={{ gridArea: 'boots' }} className="flex items-center justify-center">
          <EquipmentSlot label="Boots" icon="👢" locked />
        </div>
        <div style={{ gridArea: 'offhand' }} className="flex items-center justify-center">
          <EquipmentSlot label="Off-hand / Shield" icon="🛡️" locked />
        </div>
        <div style={{ gridArea: 'armor' }} className="flex items-center justify-center">
          <EquipmentSlot label="Armor" icon="🥋" locked />
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
                {formatItemDisplayName(template.name, equippedItem.quality_tier)}
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
