import { useState } from 'react'
import EquipmentSlot from './EquipmentSlot'
import {
  buildGearTooltip,
  formatBaseStats,
  formatItemDisplayName,
  formatQualityAndLevel,
  getItemIcon,
  getQualityColor,
} from '../game/items/equipmentBonus'
import { useEquipmentStore, type EquipSlot } from '../game/items/useEquipmentStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../game/items/useItemTemplatesStore'
import { useArrowStore, QUIVER_CAPACITY } from '../game/items/useArrowStore'
import { ARROW_TYPES } from '../game/items/arrowTypes'
import { useCharacterStore } from '../game/stats/useCharacterStore'

// Slot size for this paper-doll — scaled up from the default h-16 w-16 now that
// there's no central character placeholder competing for room (see below).
const SLOT_SIZE = 'h-24 w-24'

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
  const arrowStacks = useArrowStore((state) => state.stacks)
  const unloadFromQuiver = useArrowStore((state) => state.unloadFromQuiver)
  const unloadAllFromQuiver = useArrowStore((state) => state.unloadAllFromQuiver)

  const [selectedSlot, setSelectedSlot] = useState<EquipSlot | null>(null)

  const findEquipped = (slot: EquipSlot): { item: ItemInstance; template: ItemTemplate } | null => {
    const itemId = equippedIds[slot]
    const item = itemId ? items.find((entry) => entry.id === itemId) : undefined
    const template = item && templates.find((entry) => entry.id === item.template_id)
    return item && template ? { item, template } : null
  }

  const selected = selectedSlot ? findEquipped(selectedSlot) : null
  // 0/1/2, ordered — same convention as combat's auto-advance consumption.
  const quiverStacks = arrowStacks.filter((stack) => stack.quiverSlot !== null)

  return (
    <div className="space-y-4">
      <div
        className="mx-auto grid max-w-sm gap-3"
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
              {getItemIcon(selected.template.slot_type)}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {formatItemDisplayName(selected.template.name, selected.item.quality_tier, selected.item.composition_level)}
              </p>
              <p className="text-xs text-slate-500">{formatQualityAndLevel(selected.item.quality_tier, selected.item.level)}</p>
              <p className="text-xs text-slate-500">{formatBaseStats(selected.template.base_stats, selected.item.quality_tier)}</p>
            </div>
          </div>

          {selectedSlot === 'quiver' && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs uppercase tracking-wide text-slate-500">Quiver slots</p>
              {Array.from({ length: QUIVER_CAPACITY }, (_, slotIndex) => {
                // A depleted stack (count 0) shows as Empty and is silently
                // evictable by the next Load — see useArrowStore.loadIntoQuiver.
                const stack = quiverStacks.find((entry) => entry.quiverSlot === slotIndex && entry.count > 0)

                return (
                  <div
                    key={slotIndex}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs"
                  >
                    {stack ? (
                      <>
                        <span className="text-slate-200">
                          {ARROW_TYPES[stack.arrowType].displayName}s: {stack.count}
                        </span>
                        <button
                          type="button"
                          onClick={() => void unloadFromQuiver(stack.id)}
                          className="shrink-0 rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500"
                        >
                          Unload
                        </button>
                      </>
                    ) : (
                      <span className="text-slate-600">Empty — load arrows from your Inventory</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setEquippedItem(selectedSlot, null)
              if (selectedSlot === 'quiver') {
                void unloadAllFromQuiver()
              }
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
