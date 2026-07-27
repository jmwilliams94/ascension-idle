import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useArrowStore } from '../game/items/useArrowStore'
import { useShopStore } from '../game/hud/useShopStore'
import { ARROW_TYPES, ARROW_TYPE_ORDER, type ArrowTypeId } from '../game/items/arrowTypes'

// Renders in the same reserved rectangle BottomNav normally occupies (see
// GameShell), closable via the X — an overlay, not another HudTabs tab. Only
// Hunter has anything to buy this step.
export default function ShopOverlay() {
  const close = useShopStore((state) => state.close)

  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const gold = useProgressionStore((state) => state.gold)
  const spendGold = useProgressionStore((state) => state.spendGold)

  const arrows = useArrowStore((state) => state.arrows)
  const equippedArrowType = useArrowStore((state) => state.equippedArrowType)
  const addArrows = useArrowStore((state) => state.addArrows)
  const setEquippedArrowType = useArrowStore((state) => state.setEquippedArrowType)

  const isHunter = selectedClassId === 'hunter'

  const buy = (typeId: ArrowTypeId, quantity: number) => {
    const cost = ARROW_TYPES[typeId].price * quantity
    if (!spendGold(cost)) {
      return
    }
    addArrows(typeId, quantity)
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
            const owned = arrows[typeId]
            const isEquipped = equippedArrowType === typeId
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
                    Owned: {owned} · {type.price}g each
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-stretch gap-1">
                  <div className="flex gap-1">
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
                  <button
                    type="button"
                    disabled={isEquipped}
                    onClick={() => setEquippedArrowType(typeId)}
                    className={`rounded border px-2 py-1 ${
                      isEquipped
                        ? 'cursor-not-allowed border-slate-800 text-slate-600'
                        : 'border-sky-500 text-sky-300 hover:bg-sky-500/10'
                    }`}
                  >
                    {isEquipped ? 'Equipped' : 'Equip'}
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
