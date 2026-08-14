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

const SHOP_TABS: { id: ShopTab; label: string; icon: string }[] = [
  { id: 'weapons', label: 'Weapons', icon: '🗡️' },
  { id: 'armor', label: 'Armor', icon: '🛡️' },
  { id: 'jeweller', label: 'Jeweller', icon: '💍' },
  { id: 'potions', label: 'Potions', icon: '🧪' },
  { id: 'repair', label: 'Repair', icon: '🔨' },
]

// A template is available to the current class if it has no class restriction
// at all (required_class null — bows/rings/necklaces/boots today) or matches
// the character's own class exactly (required_class 'hunter' — Archer Hats/
// Coats today). This is what makes the Weapons/Armor tabs "dynamic": the same
// component just renders a different filtered slice per class, with no
// per-class branching needed here.
function availableToClass(template: ItemTemplate, classId: string): boolean {
  return template.required_class === null || template.required_class === classId
}

function GearRow({ template }: { template: ItemTemplate }) {
  const characterId = useActiveCharacterStore((state) => state.characterId)
  const level = useProgressionStore((state) => state.level)
  const gold = useProgressionStore((state) => state.gold)
  const buyShopItem = useInventoryStore((state) => state.buyShopItem)

  const meetsLevel = level >= template.required_level
  const canAfford = gold >= template.price
  const canBuy = meetsLevel && canAfford

  // Gold is deducted server-side (shop_buy_item RPC) only once the purchase
  // actually succeeds — no local spendGold pre-deduction, so an
  // 'inventory_full' response never costs the player gold they didn't
  // actually spend (see InventoryFullModal for how that gets resolved).
  const handleBuy = async () => {
    if (!characterId || !canBuy) {
      return
    }
    await buyShopItem(template)
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
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

      <Button
        variant="secondary"
        disabled={!canBuy}
        title={!meetsLevel ? `Requires level ${template.required_level}` : !canAfford ? 'Not enough gold' : undefined}
        onClick={() => void handleBuy()}
        className="shrink-0"
      >
        Buy
      </Button>
    </div>
  )
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
  const weaponTemplates = templates
    .filter((t) => t.slot_type === 'weapon' && availableToClass(t, selectedClassId))
    .filter((t) => !(selectedClassId === 'hunter' && t.name === 'Wooden Sword'))
    .filter((t) => t.required_level <= SHOP_MAX_LEVEL)
    .sort((a, b) => a.required_level - b.required_level)

  const armorTemplates = templates
    .filter((t) => ARMOR_SLOTS.includes(t.slot_type) && availableToClass(t, selectedClassId))
    .filter((t) => t.required_level <= SHOP_MAX_LEVEL)
    .sort((a, b) => a.required_level - b.required_level)

  const jewellerTemplates = templates
    .filter((t) => JEWELLER_SLOTS.includes(t.slot_type) && availableToClass(t, selectedClassId))
    .filter((t) => t.required_level <= SHOP_MAX_LEVEL)
    .sort((a, b) => a.required_level - b.required_level)

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
        {/* Capped + centered at lg+ only (reported too large on desktop) —
            below lg the grid stays full-width, unchanged, since only the
            desktop sizing was flagged. */}
        <div className="grid grid-cols-3 gap-3 lg:mx-auto lg:max-w-[380px]">
          {SHOP_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition-colors ${
                tab === entry.id
                  ? 'border-amber-500/70 bg-amber-500/10 text-amber-300'
                  : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:bg-slate-900'
              }`}
            >
              <span className="text-2xl" aria-hidden="true">
                {entry.icon}
              </span>
              {entry.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500">Gold: {gold}</p>

        <AscensionCard>
        {tab === 'weapons' && (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {weaponTemplates.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">Nothing available yet</p>
            ) : (
              weaponTemplates.map((template) => <GearRow key={template.id} template={template} />)
            )}
          </div>
        )}

        {tab === 'armor' && (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {armorTemplates.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">Nothing available yet</p>
            ) : (
              armorTemplates.map((template) => <GearRow key={template.id} template={template} />)
            )}
          </div>
        )}

        {tab === 'jeweller' && (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {jewellerTemplates.length === 0 ? (
              <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">Nothing available yet</p>
            ) : (
              jewellerTemplates.map((template) => <GearRow key={template.id} template={template} />)
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
                  <div
                    key={typeId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs"
                  >
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
                      variant="secondary"
                      disabled={!canBuy}
                      title={!meetsLevel ? `Requires level ${type.requiredLevel}` : undefined}
                      onClick={() => buyPotionStack(typeId)}
                      className="shrink-0"
                    >
                      Buy
                    </Button>
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
                  <div
                    key={typeId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs"
                  >
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
                      variant="secondary"
                      disabled={!canBuy}
                      title={!meetsLevel ? `Requires level ${type.requiredLevel}` : undefined}
                      onClick={() => buyPotionStack(typeId)}
                      className="shrink-0"
                    >
                      Buy
                    </Button>
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
                  <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
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
