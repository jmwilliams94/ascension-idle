import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import type { MaterialEntry } from './ForgeMaterialSlot'
import { Button } from './ui/Button'
import { buildGearTooltip, formatItemDisplayName, getGearIconSrc, getItemIcon, getQualityColor } from '../game/items/equipmentBonus'
import { compositionPointValue, isCompositionMaxed, simulateCompositionFeed } from '../game/items/forgeCosts'
import type { ItemInstance } from '../game/items/useInventoryStore'
import type { ItemTemplate } from '../game/items/useItemTemplatesStore'

interface ForgeCompositionPanelProps {
  item: ItemInstance
  template: ItemTemplate | null
  entries: MaterialEntry[]
  busy: boolean
  onFeed: () => void
  feedError: string | null
}

// What the item would actually look like after the staged feed — same tile
// renderer as everywhere else in the game, just fed a hypothetical
// composition_level/points so its "+N" badge and tier ember effect preview
// the result, rather than a separate stat-bonus readout.
function ResultPreviewTile({ item, template, previewLevel, previewPoints }: { item: ItemInstance; template: ItemTemplate; previewLevel: number; previewPoints: number }) {
  const previewItem: ItemInstance = { ...item, composition_level: previewLevel, composition_points: previewPoints }

  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-[10px] uppercase tracking-wide text-slate-600">Result</p>
      <div className={SLOT_SIZE_CLASS}>
        <InventorySlot
          slotId="composition-result-preview"
          filled
          sizeClassName={SLOT_SIZE_CLASS}
          icon={getItemIcon(template.slot_type)}
          iconSrc={getGearIconSrc(template.name, item.quality_tier)}
          qualityColor={getQualityColor(item.quality_tier)}
          compositionLevel={previewLevel}
          label={formatItemDisplayName(template.name, item.quality_tier, previewLevel)}
          tooltip={buildGearTooltip(previewItem, template)}
        />
      </div>
    </div>
  )
}

// Composition preview (shown in Forge's Preview column once the Material slot
// holds a stone/gear entry — see ForgePanel's materialMode inference) — no
// RNG, no success/fail state: the player drags up to two stones and/or gear
// items into the Material slot (see ForgeMaterialSlot, rendered separately
// now — this component only shows the resulting item + Feed button), sees
// exactly what feeding them would produce (including crossing one or more
// tiers at once — CompositionLoadBar above already animates that), and
// commits with "Feed", which always applies the full point value.
export default function ForgeCompositionPanel({ item, template, entries, busy, onFeed, feedError }: ForgeCompositionPanelProps) {
  const maxed = isCompositionMaxed(item.composition_level)

  const addedPoints = entries.reduce((sum, entry) => {
    if (entry.kind === 'stone') {
      return sum + compositionPointValue(entry.tier)
    }
    if (entry.kind === 'item') {
      return sum + compositionPointValue(entry.item.composition_level)
    }
    return sum
  }, 0)

  const preview = !maxed && addedPoints > 0 ? simulateCompositionFeed(item.composition_level, item.composition_points, addedPoints) : null

  return (
    <div className="space-y-3">
      {preview && template && <ResultPreviewTile item={item} template={template} previewLevel={preview.level} previewPoints={preview.points} />}

      {maxed && <p className="text-center text-[10px] text-slate-300">Already at maximum composition (+{item.composition_level}).</p>}
      {feedError && <p className="text-center text-[10px] text-red-400">{feedError}</p>}

      <Button variant="primary" disabled={busy || maxed || addedPoints <= 0} onClick={onFeed} className="w-full">
        {busy ? 'Feeding…' : 'Feed'}
      </Button>
    </div>
  )
}
