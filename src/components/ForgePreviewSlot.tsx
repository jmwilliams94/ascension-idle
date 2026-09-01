import InventorySlot, { SLOT_LABEL_HEIGHT_CLASS, SLOT_SIZE_CLASS, SLOT_WIDTH_CLASS } from './InventorySlot'
import { buildGearTooltip, formatItemDisplayName, getGearIconSrc, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

interface ForgePreviewSlotProps {
  previewItem: ItemInstance | null
  previewTemplate: ItemTemplate | null
  slotId?: string
}

// The would-be result of a staged upgrade — same tile size/tooltip mechanism
// as every other Forge slot (see ForgeUpgradeSlot), just not a drop target.
// Shared by ForgeStandardPanel and MasterForgePanel (previously duplicated
// inline in each).
export default function ForgePreviewSlot({ previewItem, previewTemplate, slotId = 'forge-preview' }: ForgePreviewSlotProps) {
  return (
    <div className={`flex flex-col items-center gap-2 ${SLOT_WIDTH_CLASS}`}>
      <div className={`flex ${SLOT_LABEL_HEIGHT_CLASS} items-center justify-center`}>
        <p className="text-center text-[10px] uppercase leading-tight tracking-wide text-slate-300">Preview</p>
      </div>

      <div className={SLOT_SIZE_CLASS}>
        {previewItem ? (
          <InventorySlot
            slotId={slotId}
            filled
            sizeClassName={SLOT_SIZE_CLASS}
            icon={getItemIcon(previewTemplate?.slot_type)}
            iconSrc={getGearIconSrc(previewTemplate?.name, previewItem.quality_tier)}
            qualityColor={getQualityColor(previewItem.quality_tier)}
            label={
              previewTemplate
                ? formatItemDisplayName(previewTemplate.name, previewItem.quality_tier, previewItem.composition_level)
                : undefined
            }
            tooltip={buildGearTooltip(previewItem, previewTemplate ?? undefined)}
          />
        ) : (
          <InventorySlot slotId={`${slotId}-empty`} filled={false} sizeClassName={SLOT_SIZE_CLASS} />
        )}
      </div>
    </div>
  )
}
