import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useShopStore } from '../game/hud/useShopStore'
import { ARROW_TYPES, ARROW_TYPE_ORDER, type ArrowTypeId } from '../game/items/arrowTypes'

// Renders as an absolutely-positioned overlay on top of GameCanvas (see GameShell),
// closable via the X — BottomNav stays visible/usable underneath rather than being
// replaced. Only Hunter has anything to buy this step. Buying always purchases one
// full stack at a time (stackSize arrows for stackSize × price gold) — a stack is
// the actual purchasable unit, not the individual arrow. Equipping a specific stack
// happens from the Inventory tab, not here.
export default function ShopOverlay() {
  const close = useShopStore((state) => state.close)
  const characterId = useActiveCharacterStore((state) => state.characterId)

  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
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

  return (
    <div className="absolute inset-0 z-10 flex flex-col rounded-3xl border border-slate-800 bg-slate-950/95 p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-200">Shop</p>
        <button
          type="button"
          onClick={close}
          aria-label="Close shop"
          className="text-slate-400 hover:text-slate-200"
        >
          ✕
        </button>
      </div>

      {!isHunter ? (
        <p className="mt-4 flex-1 text-center text-sm text-slate-500">Nothing available yet</p>
      ) : (
        <div className="mt-2 space-y-2 overflow-y-auto">
          <p className="text-xs text-slate-500">Gold: {gold}</p>

          {ARROW_TYPE_ORDER.map((typeId) => {
            const type = ARROW_TYPES[typeId]
            const owned = stacks
              .filter((stack) => stack.arrowType === typeId)
              .reduce((sum, stack) => sum + stack.count, 0)
            const stackCost = type.price * type.stackSize
            const canAfford = gold >= stackCost

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
                </div>

                <button
                  type="button"
                  disabled={!canAfford}
                  onClick={() => buyStack(typeId)}
                  className="shrink-0 rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Buy
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
