import { useEffect, useState } from 'react'
import EquipmentSlot from './EquipmentSlot'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import {
  buildGearTooltip,
  computeGearScoreFromSnapshots,
  formatBaseStats,
  formatItemDisplayName,
  formatItemLevel,
  getGearIconSrc,
  getItemIcon,
  getMaxLevelPlaceholderIconSrc,
  getQualityColor,
  itemHasDurability,
} from '../game/items/equipmentBonus'
import { useEquipmentStore, type EquipSlot } from '../game/items/useEquipmentStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../game/items/useItemTemplatesStore'
import { useGearSnapshotStore } from '../game/items/useGearSnapshotStore'
import { usePromotionStore } from '../game/items/usePromotionStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { getCurrentPromotionTitle, getNextEligiblePromotionTier } from '../game/stats/promotionHelpers'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import PromotionModal from './PromotionModal'

// Slot size for this paper-doll — scaled up from the default h-16 w-16 now that
// there's no central character placeholder competing for room (see below).
// Responsive: the fixed 96px size didn't shrink to fit the grid columns below
// (three equal `1fr` tracks inside a max-w-sm container), which get tight
// enough on a phone that a 96px tile would overflow its own column — same
// fixed-size-tile pattern that broke the Inventory grid before. Unchanged
// 96px at `lg`+.
const SLOT_SIZE = 'h-16 w-16 lg:h-24 lg:w-24'

// Multi-slot equipping (confirmed, 2026-07-31 — supersedes the earlier
// "only Main Hand is functional" version). Matches the 6 slot_types that
// actually have catalog data. The 7th slot (`quiver`, DB-wise) is the
// paper-doll's Off-hand/Shield tile — its meaning is class-dependent, see
// SECOND_HAND_BY_CLASS below.
const SLOTS: { slot: EquipSlot; label: string; icon: string; gridArea: string }[] = [
  { slot: 'hat', label: 'Head', icon: '🪖', gridArea: 'head' },
  { slot: 'necklace', label: 'Necklace', icon: '📿', gridArea: 'neck' },
  { slot: 'ring', label: 'Ring', icon: '💍', gridArea: 'ring' },
  { slot: 'weapon', label: 'Main Hand', icon: '🗡️', gridArea: 'main' },
  { slot: 'boots', label: 'Boots', icon: '👢', gridArea: 'boots' },
  { slot: 'coat', label: 'Armor', icon: '🥋', gridArea: 'armor' },
]

// Second-hand slot (2026-08-18 repurposing) — the underlying storage
// (`equipped_quiver_id`/`slot_type: 'quiver'`) is shared by all 4 classes,
// but what it means differs per class: Hunter's ammo Quiver (no stats, mirrors
// Main Hand's glow — see the `isHunter` special-casing below), Twin-soul's
// second dual-wielded weapon, or Juggernaut's Shield — all three are real,
// functional slots. Wuxia has no real item here at all; its tile is rendered
// separately below as a non-interactive dimmed echo of Main Hand.
const SECOND_HAND_BY_CLASS: Partial<Record<string, { label: string; icon: string }>> = {
  hunter: { label: 'Quiver', icon: '🏹' },
  'twin-soul': { label: 'Off Hand', icon: '⚔️' },
  juggernaut: { label: 'Shield', icon: '🛡️' },
}

// Paper-doll layout (2026-08-05, confirmed with the user from a hand-drawn
// reference: Head/Chest(Armor)/Boots stacked in a center column, Necklace
// above Off-hand/Shield/Quiver on the left, Ring above Main Hand weapon on
// the right — supersedes the earlier "right column of 4 + bottom row of 3"
// layout, which put every slot along the right/bottom rather than centering
// the body-shaped silhouette this new layout reads as). Same for all
// classes, not just Hunter — Off-hand/Shield is the one remaining
// non-clickable, greyed-out placeholder for every non-Hunter class — no
// shield item_family exists in the catalog at all (see CLAUDE.md's Gear
// slots note).
//
// Revised same day, per the user's follow-up ("I want the necklace to be in
// line with the spacing of the helmet/chest... I want the off hand to be in
// between the chest and the boots") — the grid gained two more rows so the
// side pairs (Necklace/Ring, Off-hand/Main Hand) each sit staggered between
// the center column's rows, not aligned with one of them — see the grid
// definition below for the actual row layout.
//
// The central character placeholder (PaperDollBody, an abstract/geometric
// segmented rectangle) was removed in an earlier pass — CLAUDE.md flagged
// its fate as an open decision ("keep the abstract box... or design a real
// static per-class portrait... Not decided yet"); the decision was to drop
// it rather than replace it. This layout's own silhouette (three slots
// stacked center, staggered pairs flanking either side) incidentally reads
// as a body shape on its own, without needing that placeholder back.
export default function EquipmentPanel() {
  const equippedIds = useEquipmentStore((state) => state.equippedIds)
  const setEquippedItem = useEquipmentStore((state) => state.setEquippedItem)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const gearSnapshots = useGearSnapshotStore((state) => state.snapshots)
  const gearScore = computeGearScoreFromSnapshots(gearSnapshots)
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const isHunter = selectedClassId === 'hunter'
  const secondHandConfig = SECOND_HAND_BY_CLASS[selectedClassId]
  const characterName = useCharacterRecordStore((state) => state.characterName)

  // Class Promotion (cosmetic title + one-time reward per tier) — see
  // CLAUDE.accounts-and-classes.md. promotionLevel is server-authoritative,
  // hydrated in useCharacterRecordStore.
  const promotionLevel = useCharacterStore((state) => state.promotionLevel)
  const promotionTiers = usePromotionStore((state) => state.tiers)
  const characterLevel = useProgressionStore((state) => state.level)
  const activeCharacterId = useActiveCharacterStore((state) => state.characterId)
  const currentTitle = getCurrentPromotionTitle(promotionTiers, selectedClassId, promotionLevel)
  const nextPromotionTier = getNextEligiblePromotionTier(promotionTiers, selectedClassId, promotionLevel)
  const [promotionModalOpen, setPromotionModalOpen] = useState(false)

  const [selectedSlot, setSelectedSlot] = useState<EquipSlot | null>(null)

  const findEquipped = (slot: EquipSlot): { item: ItemInstance; template: ItemTemplate } | null => {
    const itemId = equippedIds[slot]
    const item = itemId ? items.find((entry) => entry.id === itemId) : undefined
    const template = item && templates.find((entry) => entry.id === item.template_id)
    return item && template ? { item, template } : null
  }

  const selected = selectedSlot ? findEquipped(selectedSlot) : null

  // Lock editing (requested by the user, replacing the earlier per-popover
  // Lock/Unlock buttons scattered across Inventory/Bank/Forge/Shop — "too
  // many Lock buttons on gear"): a single small padlock toggle, bottom-left
  // of this paper-doll card. Toggling it on snapshots every currently-
  // equipped item's real `locked` value into `pendingLocked`; tapping an
  // equipped tile while active flips its pending value only (no RPC yet,
  // and no detail-card/Unequip selection — the tile's onClick is repurposed
  // for the duration of edit mode). Confirm diffs pendingLocked against each
  // item's real value and only calls setItemLocked for the ones that
  // actually changed; Cancel (or toggling the padlock off directly)
  // discards pendingLocked with no calls at all.
  const setItemLocked = useInventoryStore((state) => state.setItemLocked)
  const [lockEditMode, setLockEditMode] = useState(false)
  const [pendingLocked, setPendingLocked] = useState<Record<string, boolean>>({})
  const [savingLocks, setSavingLocks] = useState(false)

  const allEquippedItems = (): ItemInstance[] => {
    const slots: EquipSlot[] = [...SLOTS.map((s) => s.slot), ...(secondHandConfig ? (['quiver'] as EquipSlot[]) : [])]
    return slots
      .map((slot) => findEquipped(slot)?.item)
      .filter((item): item is ItemInstance => Boolean(item))
  }

  const enterLockEditMode = () => {
    setSelectedSlot(null)
    setPendingLocked(Object.fromEntries(allEquippedItems().map((item) => [item.id, item.locked])))
    setLockEditMode(true)
  }

  const cancelLockEditMode = () => {
    setLockEditMode(false)
    setPendingLocked({})
  }

  const confirmLockEditMode = async () => {
    const changed = allEquippedItems().filter((item) => pendingLocked[item.id] !== undefined && pendingLocked[item.id] !== item.locked)
    setSavingLocks(true)
    await Promise.all(changed.map((item) => setItemLocked(item.id, pendingLocked[item.id])))
    setSavingLocks(false)
    setLockEditMode(false)
    setPendingLocked({})
  }

  // Same onError-fallback fix as InventorySlot.tsx/EquipmentSlot.tsx (see
  // their comments for the full root cause): this detail card renders its
  // own third, inline copy of the iconSrc-over-icon gear icon, so it needs
  // its own copy of the failure tracking too. Reset whenever the selected
  // item changes so a stale failure doesn't stick to a different item.
  const [detailIconLoadFailed, setDetailIconLoadFailed] = useState(false)
  useEffect(() => {
    setDetailIconLoadFailed(false)
  }, [selected?.item.id])

  return (
    <div className="space-y-4">
      <AscensionCard title={characterName || 'Character'}>
      <div
        className="mx-auto grid max-w-sm gap-x-2 gap-y-3 lg:gap-x-3 lg:gap-y-4"
        style={{
          gridTemplateColumns: '1fr 1fr 1fr',
          // 5 rows now, not 3 (2026-08-05, confirmed with the user: "I want
          // the necklace to be in line with the spacing of the
          // helmet/chest... I want the off hand to be in between the chest
          // and the boots"). Necklace/Ring and Off-hand/Main-Hand each get
          // their own row, sitting between the center column's three main
          // rows (Head/Armor/Boots) rather than aligned with one of them —
          // since every row is the same tile height and gap-y is uniform,
          // each side-pair row lands exactly at the vertical midpoint
          // between the center rows above and below it.
          gridTemplateAreas: '". head ." "neck . ring" ". armor ." "offhand . main" ". boots ."',
        }}
      >
        {[
          ...SLOTS,
          ...(secondHandConfig
            ? [{ slot: 'quiver' as EquipSlot, label: secondHandConfig.label, icon: secondHandConfig.icon, gridArea: 'offhand' }]
            : []),
        ].map(({ slot, label, icon, gridArea }) => {
          const equipped = findEquipped(slot)
          // Cosmetic-only (confirmed with the user, 2026-08-07), Hunter's
          // Quiver only: its own quality tier is meaningless (it has no stat
          // bonuses and is never dropped/upgraded), so its glow/ember effect
          // mirrors whatever Bow is equipped in Main Hand instead — purely a
          // display match, doesn't touch the Quiver's real tooltip/stats
          // below, and has no effect on the Quiver's actual (always-Normal)
          // tier. Twin-soul's off-hand weapon and Juggernaut's Shield are
          // real gear with their own real quality tier, so they don't mirror
          // Main Hand at all.
          const glowQualityTier =
            slot === 'quiver' && isHunter ? findEquipped('weapon')?.item.quality_tier : equipped?.item.quality_tier

          return (
            <div key={slot} style={{ gridArea }} className={`flex items-center justify-center ${equipped ? '' : 'opacity-40'}`}>
              <EquipmentSlot
                label={
                  equipped
                    ? formatItemDisplayName(equipped.template.name, equipped.item.quality_tier, equipped.item.composition_level)
                    : `${label} — empty`
                }
                icon={equipped ? getItemIcon(equipped.template.slot_type) : icon}
                iconSrc={equipped ? getGearIconSrc(equipped.template.name, equipped.item.quality_tier) : undefined}
                placeholderIconSrc={equipped ? undefined : getMaxLevelPlaceholderIconSrc(templates, selectedClassId, slot)}
                filled={Boolean(equipped)}
                qualityColor={equipped ? getQualityColor(glowQualityTier ?? 'normal') : undefined}
                compositionLevel={equipped?.item.composition_level}
                broken={equipped && itemHasDurability(equipped.template.slot_type) ? equipped.item.durability <= 0 : undefined}
                itemLocked={
                  equipped ? (lockEditMode ? (pendingLocked[equipped.item.id] ?? equipped.item.locked) : equipped.item.locked) : undefined
                }
                selected={!lockEditMode && selectedSlot === slot}
                onClick={
                  !equipped
                    ? undefined
                    : lockEditMode
                      ? () =>
                          setPendingLocked((current) => ({
                            ...current,
                            [equipped.item.id]: !(current[equipped.item.id] ?? equipped.item.locked),
                          }))
                      : () => setSelectedSlot((current) => (current === slot ? null : slot))
                }
                tooltip={
                  equipped
                    ? buildGearTooltip(
                        // Same mirror as glowQualityTier above (2026-08-14),
                        // Hunter's Quiver only — its own tooltip (title/color)
                        // should read as whatever quality the equipped Bow
                        // is, not its own always-Normal tier. Quiver has no
                        // base_stats, so this can't affect any displayed stat
                        // numbers. Twin-soul/Juggernaut's real second-hand
                        // gear shows its own real tooltip, untouched.
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

        {selectedClassId === 'wuxia' && (
          // Wuxia has no real item in this slot at all — the Backsword's
          // off-hand blade is part of the weapon's own sprite, not a
          // separate equip. This just echoes whatever's in Main Hand at
          // reduced opacity to signal "occupied, not equippable" (per the
          // user), rather than showing the generic locked placeholder other
          // not-yet-built slots use.
          <div style={{ gridArea: 'offhand' }} className="flex items-center justify-center opacity-40">
            {(() => {
              const mainHand = findEquipped('weapon')
              return (
                <EquipmentSlot
                  label="Off Hand"
                  icon={mainHand ? getItemIcon(mainHand.template.slot_type) : '⚔️'}
                  iconSrc={mainHand ? getGearIconSrc(mainHand.template.name, mainHand.item.quality_tier) : undefined}
                  placeholderIconSrc={mainHand ? undefined : getMaxLevelPlaceholderIconSrc(templates, 'wuxia', 'weapon')}
                  filled={Boolean(mainHand)}
                  qualityColor={mainHand ? getQualityColor(mainHand.item.quality_tier) : undefined}
                  sizeClassName={SLOT_SIZE}
                />
              )
            })()}
          </div>
        )}

        {!secondHandConfig && selectedClassId !== 'wuxia' && (
          <div style={{ gridArea: 'offhand' }} className="flex items-center justify-center">
            <EquipmentSlot label="Off-hand / Shield" icon="🛡️" locked sizeClassName={SLOT_SIZE} />
          </div>
        )}
      </div>

      {/* Lock editing (requested by the user) — one small padlock toggle,
          bottom-left of this card, replacing the old per-popover Lock/Unlock
          buttons scattered across every gear tile's own detail view. */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => (lockEditMode ? cancelLockEditMode() : enterLockEditMode())}
          title={lockEditMode ? 'Cancel' : 'Lock/unlock equipped gear'}
          className={`rounded-lg border px-2.5 py-1.5 text-sm ${
            lockEditMode ? 'border-amber-400 bg-amber-500/10 text-amber-300' : 'border-slate-700 text-slate-300 hover:border-amber-500/50'
          }`}
        >
          🔒
        </button>
        {lockEditMode && (
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-slate-500">Tap gear to toggle Lock</p>
            <Button variant="primary" disabled={savingLocks} onClick={() => void confirmLockEditMode()}>
              {savingLocks ? 'Saving…' : 'Confirm'}
            </Button>
          </div>
        )}
      </div>
      </AscensionCard>

      <AscensionCard contentClassName="p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-300">
              Title: <span className="font-medium text-amber-300">{currentTitle}</span>
            </p>
            <p className="text-xs text-amber-300">Gear Score: {gearScore}</p>
          </div>
          {nextPromotionTier && characterLevel >= nextPromotionTier.level && (
            <Button variant="primary" onClick={() => setPromotionModalOpen(true)}>
              Promote
            </Button>
          )}
        </div>
      </AscensionCard>

      {promotionModalOpen && activeCharacterId && nextPromotionTier && (
        <PromotionModal tier={nextPromotionTier} characterId={activeCharacterId} onClose={() => setPromotionModalOpen(false)} />
      )}

      {selected && selectedSlot && (
        <AscensionCard contentClassName="p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-lg"
              style={{ borderColor: getQualityColor(selected.item.quality_tier) }}
            >
              {getGearIconSrc(selected.template.name, selected.item.quality_tier) && !detailIconLoadFailed ? (
                <img
                  src={getGearIconSrc(selected.template.name, selected.item.quality_tier)}
                  alt=""
                  className="h-4/5 w-4/5 object-contain"
                  onError={() => setDetailIconLoadFailed(true)}
                />
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

          <Button
            variant="secondary"
            onClick={() => {
              setEquippedItem(selectedSlot, null)
              setSelectedSlot(null)
            }}
            className="mt-3 w-full"
          >
            Unequip
          </Button>
        </AscensionCard>
      )}

      {!selected && !lockEditMode && <p className="text-center text-xs text-slate-500">Equip gear from your Inventory to fill these slots.</p>}
    </div>
  )
}
