import InventorySlot, { SLOT_LABEL_HEIGHT_CLASS, SLOT_SIZE_CLASS, SLOT_WIDTH_CLASS } from './InventorySlot'
import { useDraggableTile, useIsDropTarget } from './dragDropContext'
import { buildGemTooltip, getGemIconSrc, getGemTierColor, type GemTier, type GemTypeId } from '../game/items/gemTypes'

interface StagedGem {
  dragId: string
  gemId: GemTypeId
  tier: GemTier
}

interface EnchantGemSlotProps {
  gem: StagedGem | null
  onRemove: () => void
}

// Enchantress's own single Gem slot (data-drop-zone="gem") — accepts any of
// the 4 gem types at any tier, since only the tier matters for the HP roll
// (see gemCatalog.ts's ENCHANT_HP_RANGE_BY_TIER). Mirrors ForgeSocketSlot's
// shape but always "unlocked" — there's no per-item gate here.
export default function EnchantGemSlot({ gem, onRemove }: EnchantGemSlotProps) {
  const isDropTarget = useIsDropTarget('gem')
  const drag = useDraggableTile({
    enabled: Boolean(gem),
    payload: gem ? { id: gem.dragId, icon: '💎', iconSrc: getGemIconSrc(gem.gemId, gem.tier), qualityColor: getGemTierColor(gem.tier) } : null,
    onDrop: () => onRemove(),
  })

  return (
    <div className={`flex flex-col items-center gap-2 ${SLOT_WIDTH_CLASS}`}>
      <div className={`flex ${SLOT_LABEL_HEIGHT_CLASS} items-center justify-center`}>
        <p className="text-center text-[10px] uppercase leading-tight tracking-wide text-slate-300">Gem</p>
      </div>

      <div
        data-drop-zone="gem"
        className={`${SLOT_SIZE_CLASS} shrink-0 rounded-lg transition-shadow ${
          isDropTarget ? 'ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]' : ''
        }`}
      >
        <InventorySlot
          slotId="enchant-gem-slot"
          filled={Boolean(gem)}
          sizeClassName={SLOT_SIZE_CLASS}
          emptyHint="Drop gem here"
          qualityColor={gem ? getGemTierColor(gem.tier) : undefined}
          icon={gem ? '💎' : undefined}
          iconSrc={gem ? getGemIconSrc(gem.gemId, gem.tier) : undefined}
          tooltip={gem ? buildGemTooltip(gem.gemId, gem.tier) : undefined}
          draggable={drag.draggable}
          dragging={drag.dragging}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          onPointerCancel={drag.onPointerCancel}
        />
      </div>

      {gem && (
        <button type="button" onClick={onRemove} className="text-[10px] text-slate-300 underline hover:text-slate-300">
          Remove
        </button>
      )}
    </div>
  )
}
