import { formatItemDisplayName, formatItemLevel, getQualityColor } from '../game/items/equipmentBonus'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { usePotionStore } from '../game/items/usePotionStore'
import { POTION_TYPES } from '../game/items/potionTypes'
import { useLockBodyScroll } from '../lib/useLockBodyScroll'

// Only ever set from a Shop purchase (see useInventoryStore.buyShopItem) that
// couldn't fit — combat drops go through resolve-combat's own server-side
// full-inventory handling instead (see CLAUDE.md's Inventory design). Renders
// nothing when there's no pending decision, so it's safe to mount
// unconditionally in GameShell.
export default function InventoryFullModal() {
  const pendingFullDrop = useInventoryStore((state) => state.pendingFullDrop)
  const items = useInventoryStore((state) => state.items)
  const buyShopItem = useInventoryStore((state) => state.buyShopItem)
  const cancelPendingDrop = useInventoryStore((state) => state.cancelPendingDrop)
  const templates = useItemTemplatesStore((state) => state.templates)
  // Potion stacks occupy a slot exactly like gear does (see occupiedSlotCount
  // in useInventoryStore), so they're listed here as discardable too.
  // Filtering must happen outside the selector — a selector that returns a fresh
  // array every call (via .filter() inline) makes Zustand's useSyncExternalStore
  // subscription see a "different" snapshot on every render, which triggers an
  // infinite re-render loop (React error #185, "Maximum update depth exceeded").
  const potionStacks = usePotionStore((state) => state.stacks)
  const visiblePotionStacks = potionStacks.filter((stack) => stack.count > 0)
  useLockBodyScroll(Boolean(pendingFullDrop))

  if (!pendingFullDrop) {
    return null
  }

  const newItemName = formatItemDisplayName(pendingFullDrop.template.name, 'normal')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">Inventory full</h2>
        <p className="mt-1 text-sm text-slate-400">
          You found a {newItemName}, but your bag is full. Discard an existing item to make room for it, or discard the
          new item instead.
        </p>

        <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
          {visiblePotionStacks.map((stack) => {
            const type = POTION_TYPES[stack.potionType]

            return (
              <div
                key={stack.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-slate-200">{type.displayName}</span>
                  <span className="shrink-0 text-slate-300">
                    {stack.count} / {type.stackSize}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => void buyShopItem(pendingFullDrop.template, { kind: 'potion', id: stack.id })}
                  className="shrink-0 rounded border border-red-900 px-2 py-1 text-red-400 hover:bg-red-500/10"
                >
                  Discard this
                </button>
              </div>
            )
          })}

          {items.map((item) => {
            const template = templates.find((entry) => entry.id === item.template_id)

            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: getQualityColor(item.quality_tier) }}
                  />
                  <span className="truncate text-slate-200">
                    {template ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level) : 'Unknown item'}
                  </span>
                  <span className="shrink-0 text-slate-300">{formatItemLevel(item.level)}</span>
                </div>

                <button
                  type="button"
                  onClick={() => void buyShopItem(pendingFullDrop.template, { kind: 'item', id: item.id })}
                  className="shrink-0 rounded border border-red-900 px-2 py-1 text-red-400 hover:bg-red-500/10"
                >
                  Discard this
                </button>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={cancelPendingDrop}
          className="mt-4 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500"
        >
          Discard the new item instead
        </button>
      </div>
    </div>
  )
}
