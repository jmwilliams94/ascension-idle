import { useState } from 'react'
import InventoryPanel from './InventoryPanel'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { usePotionStore } from '../game/items/usePotionStore'
import { useInventoryStore, type ItemInstance } from '../game/items/useInventoryStore'
import { useItemTemplatesStore, type ItemTemplate } from '../game/items/useItemTemplatesStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { ARROW_TYPES, ARROW_TYPE_ORDER, type ArrowTypeId } from '../game/items/arrowTypes'
import { POTION_TYPES, HP_POTION_ORDER, MP_POTION_ORDER, type PotionTypeId } from '../game/items/potionTypes'
import { buildGearTooltip, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import type { ItemTooltipData } from '../game/items/itemTooltip'

// A Shop template isn't an owned ItemInstance yet, but buildGearTooltip (the
// same universal tooltip builder Inventory/Equipment/Forge all use) needs one
// — this stands in a synthetic Normal-quality, level-at-required-level,
// no-composition preview instance, matching exactly what grantItemDrop
// actually creates on purchase (see useInventoryStore.grantItemDrop), so the
// preview honestly reflects what buying yields.
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
    created_at: '',
  }
}

type ShopTab = 'arrows' | 'weapons' | 'armor' | 'potions'

// 'quiver' rides along here (not a dedicated tab) so a Hunter can
// re-purchase one through the same generic GearRow/grantItemDrop path if
// they ever sell or lose their starter Quiver.
const ARMOR_SLOTS = ['ring', 'necklace', 'boots', 'hat', 'coat', 'quiver']

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
  const spendGold = useProgressionStore((state) => state.spendGold)
  const grantItemDrop = useInventoryStore((state) => state.grantItemDrop)

  const meetsLevel = level >= template.required_level
  const canAfford = gold >= template.price
  const canBuy = meetsLevel && canAfford

  const handleBuy = async () => {
    if (!characterId || !canBuy) {
      return
    }
    if (!spendGold(template.price)) {
      return
    }
    await grantItemDrop(template, true)
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <InventorySlot
          slotId={template.id}
          filled
          sizeClassName={SLOT_SIZE_CLASS}
          icon={getItemIcon(template.slot_type)}
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

      <button
        type="button"
        disabled={!canBuy}
        title={!meetsLevel ? `Requires level ${template.required_level}` : !canAfford ? 'Not enough gold' : undefined}
        onClick={() => void handleBuy()}
        className="shrink-0 rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Buy
      </button>
    </div>
  )
}

// Only Hunter has anything to buy this step. Buying always purchases one full stack
// at a time (stackSize arrows for stackSize × price gold) — a stack is the actual
// purchasable unit, not the individual arrow. Equipping a specific stack happens
// from the Inventory panel, not here.
export default function ShopPanel() {
  const characterId = useActiveCharacterStore((state) => state.characterId)

  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const level = useProgressionStore((state) => state.level)
  const gold = useProgressionStore((state) => state.gold)
  const spendGold = useProgressionStore((state) => state.spendGold)

  const stacks = useArrowStore((state) => state.stacks)
  const buyArrows = useArrowStore((state) => state.buyArrows)

  const potionStacks = usePotionStore((state) => state.stacks)
  const buyPotions = usePotionStore((state) => state.buyPotions)

  const templates = useItemTemplatesStore((state) => state.templates)

  const [tab, setTab] = useState<ShopTab>('arrows')

  const isHunter = selectedClassId === 'hunter'

  const buyStack = (typeId: ArrowTypeId) => {
    if (!characterId) {
      return
    }

    const type = ARROW_TYPES[typeId]
    const cost = type.price * type.stackSize
    if (!spendGold(cost)) {
      return
    }

    void buyArrows(characterId, typeId, type.stackSize)
  }

  const buyPotionStack = (typeId: PotionTypeId) => {
    if (!characterId) {
      return
    }

    const type = POTION_TYPES[typeId]
    const cost = type.price * type.stackSize
    if (!spendGold(cost)) {
      return
    }

    void buyPotions(characterId, typeId, type.stackSize)
  }

  const weaponTemplates = templates
    .filter((t) => t.slot_type === 'weapon' && availableToClass(t, selectedClassId))
    .sort((a, b) => a.required_level - b.required_level)

  const armorTemplates = templates
    .filter((t) => ARMOR_SLOTS.includes(t.slot_type) && availableToClass(t, selectedClassId))
    .sort((a, b) => a.required_level - b.required_level)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setTab('arrows')}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              tab === 'arrows' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            Arrows
          </button>
          <button
            type="button"
            onClick={() => setTab('weapons')}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              tab === 'weapons' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            Weapons
          </button>
          <button
            type="button"
            onClick={() => setTab('armor')}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              tab === 'armor' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            Armor
          </button>
          <button
            type="button"
            onClick={() => setTab('potions')}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              tab === 'potions' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            Potions
          </button>
        </div>

        <p className="text-xs text-slate-500">Gold: {gold}</p>

        {tab === 'arrows' &&
          (isHunter ? (
            <div className="space-y-2">
              {ARROW_TYPE_ORDER.map((typeId) => {
                const type = ARROW_TYPES[typeId]
                const owned = stacks.filter((stack) => stack.arrowType === typeId).reduce((sum, stack) => sum + stack.count, 0)
                const stackCost = type.price * type.stackSize
                const meetsLevel = level >= type.requiredLevel
                const canAfford = gold >= stackCost
                const canBuy = meetsLevel && canAfford

                const arrowTooltip: ItemTooltipData = {
                  title: type.displayName,
                  lines: ['Ammo'],
                  stats: [type.description],
                }

                return (
                  <div
                    key={typeId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <InventorySlot slotId={typeId} filled sizeClassName={SLOT_SIZE_CLASS} icon="🏹" label={type.displayName} tooltip={arrowTooltip} />
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

                    <button
                      type="button"
                      disabled={!canBuy}
                      title={!meetsLevel ? `Requires level ${type.requiredLevel}` : undefined}
                      onClick={() => buyStack(typeId)}
                      className="shrink-0 rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Buy
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="flex h-24 items-center justify-center text-center text-sm text-slate-500">Nothing available yet</p>
          ))}

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

        {/* Available to every class, unlike Arrows — HP/Mana are universal stats. */}
        {tab === 'potions' && (
          <div className="max-h-96 space-y-3 overflow-y-auto">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">HP Potions</p>
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

                    <button
                      type="button"
                      disabled={!canBuy}
                      title={!meetsLevel ? `Requires level ${type.requiredLevel}` : undefined}
                      onClick={() => buyPotionStack(typeId)}
                      className="shrink-0 rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Buy
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">Mana Potions</p>
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

                    <button
                      type="button"
                      disabled={!canBuy}
                      title={!meetsLevel ? `Requires level ${type.requiredLevel}` : undefined}
                      onClick={() => buyPotionStack(typeId)}
                      className="shrink-0 rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Buy
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <InventoryPanel columns={5} enableSelling />
    </div>
  )
}
