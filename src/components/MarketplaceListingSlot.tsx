import InventorySlot, { SLOT_LABEL_HEIGHT_CLASS, SLOT_SIZE_CLASS, SLOT_WIDTH_CLASS } from './InventorySlot'
import { useDraggableTile } from './dragDropContext'
import { buildGearTooltip, formatItemDisplayName, formatItemLevel, getGearIconSrc, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import { listableCurrencyLabel, listableCurrencyVisual } from '../game/marketplace/listableCurrency'
import type { ListableCurrencyType } from '../game/marketplace/useMarketplaceStore'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

// What's currently staged to list — either a real gear item or one of the 4
// listable currency types (Comet/Fallen Star/their Scrolls, 2026-08-03),
// always exactly 1 unit either way (matching gear's own "1 listing = 1
// unique item" model).
export type ListingDraftTarget =
  | { kind: 'item'; item: ItemInstance; template: ItemTemplate | null }
  | { kind: 'currency'; currencyType: ListableCurrencyType }

interface MarketplaceListingSlotProps {
  target: ListingDraftTarget | null
  onRemove: () => void
}

// The drop target for "List an Item" (see MarketplacePanel) — structurally
// mirrors ForgeUpgradeSlot.tsx exactly (single drop target, data-drop-zone
// carries the target key a dragged tile lands on, reuses InventorySlot so the
// universal hover tooltip works here too). A small, deliberate duplication
// rather than a shared generic component, matching this codebase's existing
// style (ForgeUpgradeSlot/BankGrid already have some duplication rather
// than an over-abstracted shared slot).
export default function MarketplaceListingSlot({ target, onRemove }: MarketplaceListingSlotProps) {
  const item = target?.kind === 'item' ? target.item : null
  const template = target?.kind === 'item' ? target.template : null
  const icon = item ? getItemIcon(template?.slot_type) : undefined
  const iconSrc = item ? getGearIconSrc(template?.name) : undefined
  const currencyVisual = target?.kind === 'currency' ? listableCurrencyVisual(target.currencyType) : null

  const label = !target
    ? undefined
    : target.kind === 'item'
      ? template
        ? formatItemDisplayName(template.name, target.item.quality_tier, target.item.composition_level)
        : 'Unknown item'
      : listableCurrencyLabel(target.currencyType)

  // Dragging the staged tile back out — item or currency alike — clears the
  // selection, same "nowhere else valid to drop it" behavior a Remove click
  // already has.
  const drag = useDraggableTile({
    enabled: Boolean(target),
    payload: !target
      ? null
      : target.kind === 'item'
        ? { id: target.item.id, icon: icon ?? '', iconSrc, qualityColor: getQualityColor(target.item.quality_tier) }
        : {
            id: `staged-${target.currencyType}`,
            icon: currencyVisual?.icon ?? '',
            iconSrc: currencyVisual?.iconSrc,
            qualityColor: currencyVisual?.qualityColor,
          },
    onDrop: () => onRemove(),
  })

  return (
    <div className={`flex flex-col items-center gap-2 ${SLOT_WIDTH_CLASS}`}>
      <div className={`flex ${SLOT_LABEL_HEIGHT_CLASS} items-center justify-center`}>
        <p className="text-center text-[10px] uppercase leading-tight tracking-wide text-slate-500">List for Sale</p>
      </div>

      <div data-drop-zone="marketplace-listing" className={`${SLOT_SIZE_CLASS} shrink-0`}>
        <InventorySlot
          slotId="marketplace-listing-slot"
          filled={Boolean(target)}
          sizeClassName={SLOT_SIZE_CLASS}
          emptyHint="Drop item here"
          qualityColor={item ? getQualityColor(item.quality_tier) : currencyVisual?.qualityColor}
          icon={item ? icon : currencyVisual?.icon}
          iconSrc={item ? iconSrc : currencyVisual?.iconSrc}
          label={label}
          tooltip={item ? buildGearTooltip(item, template ?? undefined) : undefined}
          draggable={drag.draggable}
          dragging={drag.dragging}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          onPointerCancel={drag.onPointerCancel}
        />
      </div>

      {target && (
        <div className="text-center">
          <p className="text-xs font-medium text-slate-200">{label}</p>
          {item && <p className="text-[10px] text-slate-500">{formatItemLevel(item.level)}</p>}
          <button type="button" onClick={onRemove} className="mt-1 text-[10px] text-slate-500 underline hover:text-slate-300">
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
