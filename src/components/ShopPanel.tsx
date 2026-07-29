import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { ARROW_TYPES, ARROW_TYPE_ORDER, type ArrowTypeId } from '../game/items/arrowTypes'

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

  if (!isHunter) {
    return <p className="flex h-full items-center justify-center text-center text-sm text-slate-500">Nothing available yet</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Gold: {gold}</p>

      {ARROW_TYPE_ORDER.map((typeId) => {
        const type = ARROW_TYPES[typeId]
        const owned = stacks.filter((stack) => stack.arrowType === typeId).reduce((sum, stack) => sum + stack.count, 0)
        const stackCost = type.price * type.stackSize
        const meetsLevel = level >= type.requiredLevel
        const canAfford = gold >= stackCost
        const canBuy = meetsLevel && canAfford

        return (
          <div
            key={typeId}
            className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs"
          >
            <div>
              <p className="font-medium text-slate-200">{type.displayName}</p>
              <p className="text-slate-500">{type.description}</p>
              <p className="text-slate-500">
                Owned: {owned} · stack of {type.stackSize} for {stackCost}g
              </p>
              {type.requiredLevel > 1 && (
                <p className={meetsLevel ? 'text-slate-500' : 'text-amber-500'}>Requires level {type.requiredLevel}</p>
              )}
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
  )
}
