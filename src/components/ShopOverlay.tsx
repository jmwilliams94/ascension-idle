import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useShopStore } from '../game/hud/useShopStore'
import { ARROW_TYPES, ARROW_TYPE_ORDER, type ArrowTypeId } from '../game/items/arrowTypes'

// Renders in the same reserved rectangle BottomNav normally occupies (see
// GameShell), closable via the X — an overlay, not another HudTabs tab. Only
// Hunter has anything to buy this step. Buying tops up existing stacks before
// creating new ones (see useArrowStore.buyArrows) — equipping a specific stack
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

  const buy = (typeId: ArrowTypeId, quantity: number) => {
    if (!characterId) {
      return
    }

    const cost = ARROW_TYPES[typeId].price * quantity
    if (!spendGold(cost)) {
      return
    }

    void buyArrows(characterId, typeId, quantity)
  }

  return (
    <div className="mt-4 flex max-h-64 flex-col rounded-xl border border-slate-800 bg-slate-950/90 p-3">
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
            const canAffordOne = gold >= type.price
            const canAffordTen = gold >= type.price * 10

            return (
              <div
                key={typeId}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs"
              >
                <div>
                  <p className="font-medium text-slate-200">{type.displayName}</p>
                  <p className="text-slate-500">{type.description}</p>
                  <p className="text-slate-500">
                    Owned: {owned} (stack of {type.stackSize}) · {type.price}g each
                  </p>
                </div>

                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={!canAffordOne}
                    onClick={() => buy(typeId, 1)}
                    className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Buy 1
                  </button>
                  <button
                    type="button"
                    disabled={!canAffordTen}
                    onClick={() => buy(typeId, 10)}
                    className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Buy 10
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
