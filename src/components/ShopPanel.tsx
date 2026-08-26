import { useState } from 'react'
import InventoryPanel from './InventoryPanel'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { usePotionStore } from '../game/items/usePotionStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../game/items/useItemTemplatesStore'
import { useRepairStore } from '../game/items/useRepairStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { POTION_TYPES, HP_POTION_ORDER, MP_POTION_ORDER, type PotionTypeId } from '../game/items/potionTypes'
import {
  buildGearTooltip,
  computeMaxDurability,
  computeRepairCost,
  getGearIconSrc,
  getItemIcon,
  getQualityColor,
  itemHasDurability,
} from '../game/items/equipmentBonus'
import { CONSUMABLE_COLOR } from '../game/items/forgeCosts'
import type { ItemTooltipData } from '../game/items/itemTooltip'
import { APP_VERSION } from '../version'

// A Shop template isn't an owned ItemInstance yet, but buildGearTooltip (the
// same universal tooltip builder Inventory/Equipment/Forge all use) needs one
// — this stands in a synthetic Normal-quality, level-at-required-level,
// no-composition preview instance, matching exactly what the shop_buy_item
// RPC actually creates on purchase (see useInventoryStore.buyShopItem), so
// the preview honestly reflects what buying yields.
function previewInstance(template: ItemTemplate): ItemInstance {
  return {
    id: template.id,
    template_id: template.id,
    owner_id: '',
    quality_tier: 'normal',
    level: template.required_level,
    composition_level: 0,
    composition_points: 0,
    sockets: [],
    enchant: null,
    durability: computeMaxDurability(template.slot_type, template.required_level) ?? 0,
    created_at: '',
    location: 'inventory',
    locked: false,
  }
}

type ShopTab = 'weapons' | 'armor' | 'jeweller' | 'potions' | 'repair'

// Rings/Necklaces split out into their own Jeweller tab (2026-08-07,
// confirmed with the user) — Armor keeps boots/hats/coats. Quiver removed
// from the Shop entirely (2026-08-14, requested by the user) — no longer
// re-purchasable here if lost.
const ARMOR_SLOTS = ['boots', 'hat', 'coat']
const JEWELLER_SLOTS = ['ring', 'necklace']

// Gear above level 120 removed from the Shop (2026-08-14, requested by the
// user).
const SHOP_MAX_LEVEL = 120

// `?v=${APP_VERSION}` cache-busts these — public/ assets keep a fixed
// filename across builds (unlike hashed src/assets imports), and GitHub
// Pages/Cloudflare serves them with a 4h Cache-Control, so overwriting one
// in place otherwise leaves already-cached players stuck on the old art
// until that expires. See navIcons.ts's matching `iconUrl` doc comment.
const SHOP_TAB_ICON_BASE = `${import.meta.env.BASE_URL}shop-tab-icons/`
function shopTabIconUrl(file: string): string {
  return `${SHOP_TAB_ICON_BASE}${file}?v=${APP_VERSION}`
}

// Real art (2026-08-14) replacing the old emoji placeholders, same
// 320x320 sharp resize-cover pipeline as public/nav-icons/.
const SHOP_TABS: { id: ShopTab; label: string; icon: string }[] = [
  { id: 'weapons', label: 'Weapons', icon: shopTabIconUrl('weapons.png') },
  { id: 'armor', label: 'Armor', icon: shopTabIconUrl('armor.png') },
  { id: 'jeweller', label: 'Jeweller', icon: shopTabIconUrl('jeweller.png') },
  { id: 'potions', label: 'Potions', icon: shopTabIconUrl('potions.png') },
  { id: 'repair', label: 'Repair', icon: shopTabIconUrl('repair.png') },
]

// A template is available to the current class if it has no class restriction
// at all (required_class null — Boots/Wooden Sword/Pickaxe today, genuinely
// shared across every class — see the backfill migration
// 20261020000000_backfill_hunter_required_class.sql for why nothing else is
// null anymore) or matches the character's own class exactly. This is what
// makes the Weapons/Armor tabs "dynamic": the same component just renders a
// different filtered slice per class, with no per-class branching needed
// here.
function availableToClass(template: ItemTemplate, classId: string): boolean {
  return template.required_class === null || template.required_class === classId
}

// Shop only carries the first few rungs of each weapon/armor line (2026-08-27,
// requested by the user) — it's meant for early/starter gear, not a mirror of
// the entire level-1-130 progression (that's what kill-drops/Forge upgrades
// are for). Groups by item_family (falling back to the template's own id for
// the rare standalone item with none, e.g. Wooden Sword) so a class with
// several distinct weapon families — Twin-soul/Juggernaut's Club/Sword/Blade —
// still shows a few of *each* rather than 3 total across all of them.
// Templates must already be sorted by required_level ascending.
const SHOP_ITEMS_PER_FAMILY = 3

function capFirstPerFamily(sortedTemplates: ItemTemplate[]): ItemTemplate[] {
  const seenCounts = new Map<string, number>()
  return sortedTemplates.filter((template) => {
    const key = template.item_family ?? template.id
    const count = seenCounts.get(key) ?? 0
    seenCounts.set(key, count + 1)
    return count < SHOP_ITEMS_PER_FAMILY
  })
}

// Buy 5 / Buy 10 call buyShopItemBulk, which runs the whole purchase loop
// server-side in a single round-trip (shop_buy_item_bulk RPC) instead of one
// request per item — previously a sequential client-side loop, visibly
// trickling items in one at a time. Still stops early on gold/room same as
// before, including 'inventory_full' leaving the existing InventoryFullModal's
// pendingFullDrop state for the player to resolve.
// Surfaces a purchase failure reason (2026-09-30, reported by the user —
// buying a Pickaxe appeared to silently do nothing; turned out GearRow never
// showed *any* buy failure for *any* item, it just quietly stopped the
// loop). 'inventory_full' still gets the richer InventoryFullModal treatment
// separately (see useInventoryStore.buyShopItem) — this is the fallback for
// every other rejection reason, which previously had no visible feedback at
// all.
function describeBuyError(error?: string): string {
  switch (error) {
    case 'not_enough_gold':
      return 'Not enough gold.'
    case 'level_too_low':
      return "You don't meet the level requirement."
    case 'wrong_class':
      return "This item isn't usable by your class."
    case 'inventory_full':
      return 'Inventory full.'
    case 'template_not_found':
    case 'not_owner':
      return "Couldn't find that item."
    default:
      // Falls through here for a genuine RPC-level failure (network error,
      // an actual SQL exception, etc.) — useInventoryStore.buyShopItem now
      // passes the raw message through instead of swallowing it, so showing
      // it beats a flat "Something went wrong" with nothing to diagnose from.
      return error ? `Something went wrong: ${error}` : 'Something went wrong.'
  }
}

function GearRow({ template, bulkBuy }: { template: ItemTemplate; bulkBuy: boolean }) {
  const characterId = useActiveCharacterStore((state) => state.characterId)
  const level = useProgressionStore((state) => state.level)
  const gold = useProgressionStore((state) => state.gold)
  const buyShopItem = useInventoryStore((state) => state.buyShopItem)
  const buyShopItemBulk = useInventoryStore((state) => state.buyShopItemBulk)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [buyError, setBuyError] = useState<string | null>(null)

  const meetsLevel = level >= template.required_level
  const canAfford = gold >= template.price
  const canBuy = meetsLevel && canAfford

  // Gold is deducted server-side (shop_buy_item/shop_buy_item_bulk RPCs) only
  // once the purchase actually succeeds — no local spendGold pre-deduction, so
  // an 'inventory_full' response never costs the player gold they didn't
  // actually spend (see InventoryFullModal for how that gets resolved).
  const handleBuyMany = async (count: number) => {
    if (!characterId || !canBuy || bulkBusy) {
      return
    }
    setBulkBusy(true)
    setBuyError(null)
    if (count === 1) {
      const result = await buyShopItem(template)
      if (!result.ok) {
        setBuyError(describeBuyError(result.error))
      }
    } else {
      const result = await buyShopItemBulk(template, count)
      if (!result.ok) {
        setBuyError(describeBuyError(result.error))
      } else if (result.error && result.purchased) {
        setBuyError(`Bought ${result.purchased} of ${count}: ${describeBuyError(result.error)}`)
      }
    }
    setBulkBusy(false)
  }

  const disabled = !canBuy || bulkBusy
  const title = !meetsLevel ? `Requires level ${template.required_level}` : !canAfford ? 'Not enough gold' : undefined

  return (
    <div className="ascension-chip-frame">
      <div className="ascension-chip-inner flex items-center justify-between gap-2 p-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <InventorySlot
            slotId={template.id}
            filled
            sizeClassName={SLOT_SIZE_CLASS}
            icon={getItemIcon(template.slot_type)}
            iconSrc={getGearIconSrc(template.name)}
            qualityColor={getQualityColor('normal')}
            label={template.name}
            tooltip={buildGearTooltip(previewInstance(template), template)}
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-200">{template.name}</p>
            <p className="text-slate-500">{template.price}g</p>
            {template.required_level > 1 && (
              <p className={meetsLevel ? 'text-slate-500' : 'text-amber-500'}>Requires level {template.required_level}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {bulkBuy && (
            <>
              <Button
                variant="primary"
                disabled={disabled}
                title={title}
                onClick={() => void handleBuyMany(10)}
                className="px-2 py-1 text-[11px]"
              >
                Buy 10
              </Button>
              <Button
                variant="primary"
                disabled={disabled}
                title={title}
                onClick={() => void handleBuyMany(5)}
                className="px-2 py-1 text-[11px]"
              >
                Buy 5
              </Button>
            </>
          )}
          <Button
            variant="primary"
            disabled={disabled}
            title={title}
            onClick={() => void handleBuyMany(1)}
            className={bulkBuy ? 'px-2 py-1 text-[11px]' : undefined}
          >
            Buy
          </Button>
        </div>
      </div>
      {buyError && <p className="px-2 pb-1.5 text-[11px] text-rose-400">{buyError}</p>}
    </div>
  )
}

// Per distinct slot_type within a tab's already-level-sorted template list,
// the first entry above level 1 gets the Buy 5/10 buttons — level-1 starter
// gear is free/trivial and not worth bulk-buying, so it's skipped rather
// than counted as "first". Rings are the one exception (confirmed with the
// user): the level-1 ring itself is the eligible one, not the level-10 ring
// that would otherwise be "first".
const BULK_BUY_ALLOW_LEVEL_1_SLOT_TYPES = new Set(['ring'])

function bulkBuyEligibleIds(sortedTemplates: ItemTemplate[]): Set<string> {
  const seenSlotTypes = new Set<string>()
  const eligible = new Set<string>()
  for (const template of sortedTemplates) {
    if (
      (template.required_level <= 1 && !BULK_BUY_ALLOW_LEVEL_1_SLOT_TYPES.has(template.slot_type)) ||
      seenSlotTypes.has(template.slot_type)
    ) {
      continue
    }
    seenSlotTypes.add(template.slot_type)
    eligible.add(template.id)
  }
  return eligible
}

export default function ShopPanel() {
  const characterId = useActiveCharacterStore((state) => state.characterId)

  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const level = useProgressionStore((state) => state.level)
  const gold = useProgressionStore((state) => state.gold)

  const potionStacks = usePotionStore((state) => state.stacks)
  const buyPotions = usePotionStore((state) => state.buyPotions)

  const templates = useItemTemplatesStore((state) => state.templates)
  const items = useInventoryStore((state) => state.items)

  const repairBusy = useRepairStore((state) => state.busy)
  const repairAll = useRepairStore((state) => state.repairAll)

  const [tab, setTab] = useState<ShopTab>('weapons')
  const [repairResult, setRepairResult] = useState<{ success: boolean; message: string } | null>(null)

  // Gold is deducted server-side (shop_buy_potion RPC) only once the
  // purchase actually succeeds — see the matching note on GearRow.handleBuy.
  const buyPotionStack = (typeId: PotionTypeId) => {
    if (!characterId) {
      return
    }

    void buyPotions(characterId, typeId, POTION_TYPES[typeId].stackSize)
  }

  // Wooden Sword is a class-agnostic legacy freebie item kept around for
  // classes with no real starter weapon of their own — Hunter has its own
  // Lucky Bow (auto-granted/auto-equipped) and the full Bow chain, so it
  // never needs to appear in a Hunter's Shop (confirmed with the user,
  // 2026-08-07).
  const weaponTemplates = capFirstPerFamily(
    templates
      .filter((t) => t.slot_type === 'weapon' && availableToClass(t, selectedClassId))
      .filter((t) => !(selectedClassId === 'hunter' && t.name === 'Wooden Sword'))
      .filter((t) => t.required_level <= SHOP_MAX_LEVEL)
      .sort((a, b) => a.required_level - b.required_level),
  )

  const armorTemplates = capFirstPerFamily(
    templates
      .filter((t) => ARMOR_SLOTS.includes(t.slot_type) && availableToClass(t, selectedClassId))
      .filter((t) => t.required_level <= SHOP_MAX_LEVEL)
      .sort((a, b) => a.required_level - b.required_level),
  )

  const jewellerTemplates = capFirstPerFamily(
    templates
      .filter((t) => JEWELLER_SLOTS.includes(t.slot_type) && availableToClass(t, selectedClassId))
      .filter((t) => t.required_level <= SHOP_MAX_LEVEL)
      .sort((a, b) => a.required_level - b.required_level),
  )

  const bulkBuyWeaponIds = bulkBuyEligibleIds(weaponTemplates)
  const bulkBuyArmorIds = bulkBuyEligibleIds(armorTemplates)
  const bulkBuyJewellerIds = bulkBuyEligibleIds(jewellerTemplates)

  // Repair All (2026-08-14, requested by the user — a single flat action, no
  // per-item picker) — every owned item (equipped, inventory, or bank) below
  // its own max durability, excluding Quiver (no durability concept at all).
  // Mirrors repair_all_items' own SQL filter/cost formula exactly.
  const damagedItems = items.flatMap((item) => {
    const template = templates.find((t) => t.id === item.template_id)
    if (!template || !itemHasDurability(template.slot_type)) {
      return []
    }
    const max = computeMaxDurability(template.slot_type, template.required_level)
    if (max === null || item.durability >= max) {
      return []
    }
    return [{ item, template, cost: computeRepairCost(template.required_level, item.quality_tier, item.durability, max) }]
  })
  const repairTotalCost = damagedItems.reduce((sum, entry) => sum + entry.cost, 0)
  const canAffordRepair = gold >= repairTotalCost

  const handleRepairAll = async () => {
    const result = await repairAll()
    if (!result.ok) {
      setRepairResult({
        success: false,
        message:
          result.error === 'already_full'
            ? 'Nothing needs repairing.'
            : result.error === 'not_enough_gold'
              ? `Need ${result.cost ?? repairTotalCost} gold (have ${result.gold ?? gold}).`
              : 'Something went wrong.',
      })
      return
    }
    setRepairResult({ success: true, message: `Repaired ${result.items_repaired ?? 0} item${result.items_repaired === 1 ? '' : 's'}.` })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        {/* One row of 5 (2026-08-14, requested by the user) — was grid-cols-3,
            which wrapped the 5 tabs onto two uneven rows. Capped + centered at
            lg+ only (reported too large on desktop), unchanged below lg. */}
        <div className="grid grid-cols-5 gap-2 lg:mx-auto lg:max-w-[520px] lg:gap-3">
          {SHOP_TABS.map((entry) =>
            tab === entry.id ? (
              <button
                key={entry.id}
                type="button"
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-amber-400 bg-amber-500/10 text-[11px] font-medium text-amber-300 lg:gap-1.5 lg:text-sm"
              >
                <img src={entry.icon} alt="" className="h-7 w-7 object-contain lg:h-10 lg:w-10" />
                {entry.label}
              </button>
            ) : (
              <div key={entry.id} className="ascension-chip-frame is-interactive aspect-square">
                <button
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className="ascension-chip-inner flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-300 hover:text-amber-100 lg:gap-1.5 lg:text-sm"
                >
                  <img src={entry.icon} alt="" className="h-7 w-7 object-contain lg:h-10 lg:w-10" />
                  {entry.label}
                </button>
              </div>
            ),
          )}
        </div>

        <p className="text-xs text-slate-500">Gold: {gold}</p>

        <AscensionCard>
        {tab === 'weapons' && (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {weaponTemplates.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">Nothing available yet</p>
            ) : (
              weaponTemplates.map((template) => (
                <GearRow key={template.id} template={template} bulkBuy={bulkBuyWeaponIds.has(template.id)} />
              ))
            )}
          </div>
        )}

        {tab === 'armor' && (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {armorTemplates.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">Nothing available yet</p>
            ) : (
              armorTemplates.map((template) => (
                <GearRow key={template.id} template={template} bulkBuy={bulkBuyArmorIds.has(template.id)} />
              ))
            )}
          </div>
        )}

        {tab === 'jeweller' && (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {jewellerTemplates.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">Nothing available yet</p>
            ) : (
              jewellerTemplates.map((template) => (
                <GearRow key={template.id} template={template} bulkBuy={bulkBuyJewellerIds.has(template.id)} />
              ))
            )}
          </div>
        )}

        {/* Available to every class, unlike Arrows — HP/Mana are universal stats. */}
        {tab === 'potions' && (
          <div className="max-h-96 space-y-3 overflow-y-auto">
            <div className="space-y-2">
              <p className="text-heading-label">HP Potions</p>
              {HP_POTION_ORDER.map((typeId) => {
                const type = POTION_TYPES[typeId]
                const owned = potionStacks
                  .filter((stack) => stack.potionType === typeId)
                  .reduce((sum, stack) => sum + stack.count, 0)
                const stackCost = type.price * type.stackSize
                const meetsLevel = level >= type.requiredLevel
                const canAfford = gold >= stackCost
                const canBuy = meetsLevel && canAfford

                const potionTooltip: ItemTooltipData = {
                  title: type.displayName,
                  icon: '🧪',
                  iconColor: CONSUMABLE_COLOR,
                  lines: ['HP Potion'],
                  stats: [type.description],
                }

                return (
                  <div key={typeId} className="ascension-chip-frame">
                    <div className="ascension-chip-inner flex items-center justify-between gap-2 p-2 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <InventorySlot slotId={typeId} filled sizeClassName={SLOT_SIZE_CLASS} icon="🧪" label={type.displayName} tooltip={potionTooltip} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-200">{type.displayName}</p>
                          <p className="text-slate-500">{type.description}</p>
                          <p className="text-slate-500">
                            Owned: {owned} · stack of {type.stackSize} for {stackCost}g
                          </p>
                          {type.requiredLevel > 1 && (
                            <p className={meetsLevel ? 'text-slate-500' : 'text-amber-500'}>Requires level {type.requiredLevel}</p>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="primary"
                        disabled={!canBuy}
                        title={!meetsLevel ? `Requires level ${type.requiredLevel}` : undefined}
                        onClick={() => buyPotionStack(typeId)}
                        className="shrink-0"
                      >
                        Buy
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="space-y-2">
              <p className="text-heading-label">Mana Potions</p>
              {MP_POTION_ORDER.map((typeId) => {
                const type = POTION_TYPES[typeId]
                const owned = potionStacks
                  .filter((stack) => stack.potionType === typeId)
                  .reduce((sum, stack) => sum + stack.count, 0)
                const stackCost = type.price * type.stackSize
                const meetsLevel = level >= type.requiredLevel
                const canAfford = gold >= stackCost
                const canBuy = meetsLevel && canAfford

                const potionTooltip: ItemTooltipData = {
                  title: type.displayName,
                  icon: '💧',
                  iconColor: CONSUMABLE_COLOR,
                  lines: ['Mana Potion'],
                  stats: [type.description],
                }

                return (
                  <div key={typeId} className="ascension-chip-frame">
                    <div className="ascension-chip-inner flex items-center justify-between gap-2 p-2 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <InventorySlot slotId={typeId} filled sizeClassName={SLOT_SIZE_CLASS} icon="💧" label={type.displayName} tooltip={potionTooltip} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-200">{type.displayName}</p>
                          <p className="text-slate-500">{type.description}</p>
                          <p className="text-slate-500">
                            Owned: {owned} · stack of {type.stackSize} for {stackCost}g
                          </p>
                          {type.requiredLevel > 1 && (
                            <p className={meetsLevel ? 'text-slate-500' : 'text-amber-500'}>Requires level {type.requiredLevel}</p>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="primary"
                        disabled={!canBuy}
                        title={!meetsLevel ? `Requires level ${type.requiredLevel}` : undefined}
                        onClick={() => buyPotionStack(typeId)}
                        className="shrink-0"
                      >
                        Buy
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'repair' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Equipped gear slowly wears down the longer you fight. A broken (0-durability) item stays equipped but stops
              contributing anything in combat until it's repaired.
            </p>

            {damagedItems.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">
                Everything's in good repair.
              </p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {damagedItems.map(({ item, template, cost }) => (
                  <div key={item.id} className="ascension-chip-frame">
                    <div className="ascension-chip-inner flex items-center justify-between gap-2 p-2 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <InventorySlot
                          slotId={item.id}
                          filled
                          sizeClassName={SLOT_SIZE_CLASS}
                          icon={getItemIcon(template.slot_type)}
                          iconSrc={getGearIconSrc(template.name)}
                          qualityColor={getQualityColor(item.quality_tier)}
                          broken={item.durability <= 0}
                          label={template.name}
                          tooltip={buildGearTooltip(item, template)}
                        />
                        <p className="truncate font-medium text-slate-200">{template.name}</p>
                      </div>
                      <p className="shrink-0 text-slate-500">{cost}g</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {repairResult && (
              <p className={`text-xs ${repairResult.success ? 'text-emerald-400' : 'text-amber-400'}`}>{repairResult.message}</p>
            )}

            <Button
              variant="primary"
              disabled={damagedItems.length === 0 || !canAffordRepair || repairBusy}
              title={damagedItems.length === 0 ? undefined : !canAffordRepair ? `Need ${repairTotalCost} gold (have ${gold}).` : undefined}
              onClick={() => void handleRepairAll()}
              className="w-full"
            >
              {repairBusy ? 'Repairing…' : `Repair All (${repairTotalCost.toLocaleString()} gold)`}
            </Button>
          </div>
        )}
        </AscensionCard>
      </div>

      <AscensionCard>
        <InventoryPanel columns={5} enableSelling />
      </AscensionCard>
    </div>
  )
}
