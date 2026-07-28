import { CLASS_DEFINITIONS } from '../game/stats/classes'
import { computeDerivedStats } from '../game/stats/derivedStats'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { computeEquipmentBonus } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'

const ATTRIBUTE_LABELS = {
  strength: 'Strength',
  agility: 'Agility',
  vitality: 'Vitality',
  spirit: 'Spirit',
} as const

export default function StatsPanel() {
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const attributes = useCharacterStore((state) => state.attributes)

  const equippedItemId = useEquipmentStore((state) => state.equippedItemId)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)

  const selectedClass = CLASS_DEFINITIONS[selectedClassId]
  const equipmentBonus = computeEquipmentBonus(equippedItemId, items, templates)
  const derived = computeDerivedStats(attributes, equipmentBonus)

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <div>
        <p className="text-sm font-medium text-slate-200">Class</p>
        <p className="mt-1 text-sm text-slate-300">
          {selectedClass.displayName} — {selectedClass.realGameName}
        </p>
        {selectedClass.placeholder && (
          <p className="mt-1 text-xs text-slate-500">Starting attributes are a placeholder, unresolved.</p>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-slate-200">Attributes</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-300">
          {(Object.keys(ATTRIBUTE_LABELS) as Array<keyof typeof ATTRIBUTE_LABELS>).map((key) => (
            <div key={key} className="flex justify-between">
              <dt className="text-slate-400">{ATTRIBUTE_LABELS[key]}</dt>
              <dd>{attributes[key]}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <p className="text-sm font-medium text-slate-200">Derived stats</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-300">
          <div className="flex justify-between">
            <dt className="text-slate-400">HP</dt>
            <dd>{derived.hp}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">MP</dt>
            <dd>{derived.mp}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Physical Attack</dt>
            <dd>{derived.physicalAttack}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Magic Attack</dt>
            <dd>{derived.magicAttack}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Attack Speed</dt>
            <dd>{derived.attackSpeed.toFixed(1)}/s</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
