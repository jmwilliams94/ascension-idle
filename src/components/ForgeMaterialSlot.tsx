import { motion } from 'framer-motion'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { buildGearTooltip, formatItemDisplayName, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import {
  DRAGONBALL_COLOR,
  DRAGONBALL_ICON_SRC,
  MATERIAL_COLOR,
  METEOR_ICON_SRC,
  buildDragonballTooltip,
  buildMeteorTooltip,
  buildStoneTooltip,
  compositionPointValue,
} from '../game/items/forgeCosts'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

// Fed as a real gear item (destroyed on Feed), a single stone (stones don't
// stack — each entry is one stone), or a single Meteor/DragonBall tile (see
// ForgePanel — dropping one of these doesn't literally consume that exact
// unit, it just tells the Material slot which action the player means:
// Meteor -> Level Upgrade, DragonBall -> Quality Upgrade, both flat-cost-1
// so there's never a reason to stack more than one).
export type MaterialEntry =
  | { kind: 'stone'; id: string; tier: number }
  | { kind: 'item'; id: string; item: ItemInstance }
  | { kind: 'currency'; id: string; currencyType: 'meteor' | 'dragonball' }

export const MAX_MATERIAL_ENTRIES = 2

interface ForgeMaterialSlotProps {
  entries: MaterialEntry[]
  templates: ItemTemplate[]
  onRemoveEntry: (id: string) => void
}

// The Forge's single material drop target (data-drop-zone="material" — see
// dragDropContext.ts) — one column, not two side-by-side boxes. What lands
// here determines the upgrade path (see ForgePanel's materialMode
// inference): a Meteor/DragonBall always collapses to a single entry (their
// cost is flat, nothing more to add); a stone or gear-fuel item stacks up to
// MAX_MATERIAL_ENTRIES, sliding the first one up to make room for the second
// below it (framer-motion's `layout` animates that reflow automatically).
export default function ForgeMaterialSlot({ entries, templates, onRemoveEntry }: ForgeMaterialSlotProps) {
  const showSecondSlotHint = entries.length === 1 && entries[0].kind !== 'currency'

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">Material</p>

      <div data-drop-zone="material" className="flex flex-col items-center gap-1.5">
        {entries.length === 0 && (
          <div className={SLOT_SIZE_CLASS}>
            <InventorySlot slotId="forge-material-empty" filled={false} sizeClassName={SLOT_SIZE_CLASS} emptyHint="Drop item here" />
          </div>
        )}

        {entries.map((entry) => {
          if (entry.kind === 'currency') {
            return (
              <motion.div layout key={entry.id} className={SLOT_SIZE_CLASS}>
                <InventorySlot
                  slotId={entry.id}
                  filled
                  sizeClassName={SLOT_SIZE_CLASS}
                  iconSrc={entry.currencyType === 'meteor' ? METEOR_ICON_SRC : DRAGONBALL_ICON_SRC}
                  qualityColor={entry.currencyType === 'meteor' ? MATERIAL_COLOR : DRAGONBALL_COLOR}
                  label={entry.currencyType === 'meteor' ? 'Meteor' : 'DragonBall'}
                  tooltip={entry.currencyType === 'meteor' ? buildMeteorTooltip() : buildDragonballTooltip()}
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
                qualityColor={getQualityColor(entry.item.quality_tier)}
                badge={`${compositionPointValue(entry.item.composition_level)}`}
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
