import { motion } from 'framer-motion'
import InventorySlot, { SLOT_LABEL_HEIGHT_CLASS, SLOT_SIZE_CLASS, SLOT_WIDTH_CLASS } from './InventorySlot'
import { useIsDropTarget } from './dragDropContext'
import {
  buildGearTooltip,
  formatItemDisplayName,
  getGearIconSrc,
  getItemIcon,
  getQualityColor,
  itemHasDurability,
} from '../game/items/equipmentBonus'
import {
  FALLEN_STAR_COLOR,
  FALLEN_STAR_ICON_SRC,
  FALLEN_STAR_SCROLL_ICON_SRC,
  MATERIAL_COLOR,
  COMET_ICON_SRC,
  COMET_SCROLL_ICON_SRC,
  buildFallenStarTooltip,
  buildFallenStarScrollTooltip,
  buildCometTooltip,
  buildCometScrollTooltip,
  buildStoneTooltip,
  compositionPointValue,
  getStoneIconSrc,
} from '../game/items/forgeCosts'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

// Fed as a real gear item (destroyed on Feed), a single stone (stones don't
// stack — each entry is one stone), or a single Comet/Fallen Star tile (see
// ForgePanel — dropping one of these doesn't literally consume that exact
// unit, it just tells the Material slot which action the player means:
// Comet -> Level Upgrade, Fallen Star -> Quality Upgrade, both flat-cost-1
// so there's never a reason to stack more than one). A dropped Comet
// Scroll/Fallen Star Scroll (2026-08-13) collapses to the same 'currency'
// entry with `isScroll: true` — same currencyType-driven upgrade path, but
// triggers the *Scroll* RPC (10 chained attempts) instead of a single one.
export type MaterialEntry =
  | { kind: 'stone'; id: string; tier: number }
  | { kind: 'item'; id: string; item: ItemInstance }
  | { kind: 'currency'; id: string; currencyType: 'comet' | 'fallen_star'; isScroll?: boolean }

export const MAX_MATERIAL_ENTRIES = 2

interface ForgeMaterialSlotProps {
  entries: MaterialEntry[]
  templates: ItemTemplate[]
  onRemoveEntry: (id: string) => void
}

// The Forge's single material drop target (data-drop-zone="material" — see
// dragDropContext.ts) — one column, not two side-by-side boxes. What lands
// here determines the upgrade path (see ForgePanel's materialMode
// inference): a Comet/Fallen Star always collapses to a single entry (their
// cost is flat, nothing more to add); a stone or gear-fuel item stacks up to
// MAX_MATERIAL_ENTRIES, sliding the first one up to make room for the second
// below it (framer-motion's `layout` animates that reflow automatically).
export default function ForgeMaterialSlot({ entries, templates, onRemoveEntry }: ForgeMaterialSlotProps) {
  const showSecondSlotHint = entries.length === 1 && entries[0].kind !== 'currency'
  const isDropTarget = useIsDropTarget('material')

  return (
    <div className={`flex flex-col items-center gap-2 ${SLOT_WIDTH_CLASS}`}>
      <div className={`flex ${SLOT_LABEL_HEIGHT_CLASS} items-center justify-center`}>
        <p className="text-center text-[10px] uppercase leading-tight tracking-wide text-slate-500">Material</p>
      </div>

      <div
        data-drop-zone="material"
        className={`flex flex-col items-center gap-1.5 rounded-lg p-1 transition-shadow ${
          isDropTarget ? 'ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]' : ''
        }`}
      >
        {entries.length === 0 && (
          <div className={SLOT_SIZE_CLASS}>
            <InventorySlot slotId="forge-material-empty" filled={false} sizeClassName={SLOT_SIZE_CLASS} emptyHint="Drop item here" />
          </div>
        )}

        {entries.map((entry) => {
          if (entry.kind === 'currency') {
            const isComet = entry.currencyType === 'comet'
            const iconSrc = entry.isScroll
              ? isComet
                ? COMET_SCROLL_ICON_SRC
                : FALLEN_STAR_SCROLL_ICON_SRC
              : isComet
                ? COMET_ICON_SRC
                : FALLEN_STAR_ICON_SRC
            const label = entry.isScroll ? (isComet ? 'Comet Scroll' : 'Fallen Star Scroll') : isComet ? 'Comet' : 'Fallen Star'
            const tooltip = entry.isScroll
              ? isComet
                ? buildCometScrollTooltip()
                : buildFallenStarScrollTooltip()
              : isComet
                ? buildCometTooltip()
                : buildFallenStarTooltip()

            return (
              <motion.div layout key={entry.id} className={SLOT_SIZE_CLASS}>
                <InventorySlot
                  slotId={entry.id}
                  filled
                  sizeClassName={SLOT_SIZE_CLASS}
                  iconSrc={iconSrc}
                  qualityColor={isComet ? MATERIAL_COLOR : FALLEN_STAR_COLOR}
                  label={label}
                  tooltip={tooltip}
                  onClick={() => onRemoveEntry(entry.id)}
                />
              </motion.div>
            )
          }

          if (entry.kind === 'stone') {
            return (
              <motion.div layout key={entry.id} className={SLOT_SIZE_CLASS}>
                <InventorySlot
                  slotId={entry.id}
                  filled
                  sizeClassName={SLOT_SIZE_CLASS}
                  icon="🔷"
                  iconSrc={getStoneIconSrc(entry.tier)}
                  iconSizeClassName="h-3/5 w-3/5"
                  qualityColor={MATERIAL_COLOR}
                  badge={`${compositionPointValue(entry.tier)}`}
                  label={`+${entry.tier} Stone`}
                  tooltip={buildStoneTooltip(entry.tier)}
                  onClick={() => onRemoveEntry(entry.id)}
                />
              </motion.div>
            )
          }

          const template = templates.find((t) => t.id === entry.item.template_id)

          return (
            <motion.div layout key={entry.id} className={SLOT_SIZE_CLASS}>
              <InventorySlot
                slotId={entry.id}
                filled
                sizeClassName={SLOT_SIZE_CLASS}
                icon={getItemIcon(template?.slot_type)}
                iconSrc={getGearIconSrc(template?.name, entry.item.quality_tier)}
                qualityColor={getQualityColor(entry.item.quality_tier)}
                badge={`${compositionPointValue(entry.item.composition_level)}`}
                compositionLevel={entry.item.composition_level}
                broken={itemHasDurability(template?.slot_type) ? entry.item.durability <= 0 : undefined}
                label={template ? formatItemDisplayName(template.name, entry.item.quality_tier, entry.item.composition_level) : 'Unknown item'}
                tooltip={buildGearTooltip(entry.item, template)}
                onClick={() => onRemoveEntry(entry.id)}
              />
            </motion.div>
          )
        })}

        {showSecondSlotHint && (
          <motion.div layout className={SLOT_SIZE_CLASS}>
            <InventorySlot slotId="forge-material-slot-2" filled={false} sizeClassName={SLOT_SIZE_CLASS} emptyHint="+" />
          </motion.div>
        )}
      </div>
    </div>
  )
}
