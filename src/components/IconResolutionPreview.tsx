import InventorySlot from './InventorySlot'
import type { ItemTooltipData } from '../game/items/itemTooltip'

// Viewing-only comparison, requested by the user (2026-08-04) while
// evaluating whether gear icons should be sourced/processed at a higher
// native resolution than the game's usual 160x160 (see
// getGearIconSrc/ITEM_ICON_OVERRIDES in equipmentBonus.ts) — not a real
// gear item, not wired into any gameplay system. Both tiles use the same
// InventorySlot component every real Inventory/Forge/Bank tile uses, so the
// comparison reflects exactly how each resolution actually renders in-game
// (icon scaling, quality border, hover tooltip), just at a much larger
// on-screen size than a real 56-64px tile so any sharpness difference is
// actually visible. stripeback-bow-320.png is a one-off test asset, not
// part of the normal icon set — delete both it and this component once the
// comparison has served its purpose.
const PREVIEW_SIZE_CLASS = 'h-40 w-40'

const STANDARD_SRC = `${import.meta.env.BASE_URL}item-icons/stripeback-bow.png`
const DOUBLE_SRC = `${import.meta.env.BASE_URL}item-icons/stripeback-bow-320.png`

const standardTooltip: ItemTooltipData = {
  title: 'Stripeback Bow (160×160)',
  lines: ['Standard resolution', 'Same processing pipeline every other gear icon uses'],
}

const doubleTooltip: ItemTooltipData = {
  title: 'Stripeback Bow (320×320)',
  lines: ['Double resolution', 'Same source image, same pipeline, larger target size'],
}

export default function IconResolutionPreview() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Side-by-side comparison of the same Stripeback Bow source processed at the game's usual 160×160 versus double
        resolution (320×320), both shown here larger than a real Inventory tile so any sharpness difference is actually
        visible. Viewing only — not a real item, not wired into gameplay.
      </p>

      <div className="flex flex-wrap justify-center gap-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <InventorySlot
            slotId="icon-preview-standard"
            filled
            iconSrc={STANDARD_SRC}
            qualityColor="#FFFFFF"
            label="Stripeback Bow (160×160)"
            tooltip={standardTooltip}
            sizeClassName={PREVIEW_SIZE_CLASS}
          />
          <p className="text-xs font-medium text-slate-300">160×160 (usual)</p>
        </div>

        <div className="flex flex-col items-center gap-2 text-center">
          <InventorySlot
            slotId="icon-preview-double"
            filled
            iconSrc={DOUBLE_SRC}
            qualityColor="#FFFFFF"
            label="Stripeback Bow (320×320)"
            tooltip={doubleTooltip}
            sizeClassName={PREVIEW_SIZE_CLASS}
          />
          <p className="text-xs font-medium text-slate-300">320×320 (double)</p>
        </div>
      </div>
    </div>
  )
}
