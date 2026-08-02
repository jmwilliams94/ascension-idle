import { useState } from 'react'
import { CLASS_DEFINITIONS } from '../game/stats/classes'
import { computeDerivedStats } from '../game/stats/derivedStats'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { computeEquipmentBonus } from '../game/items/equipmentBonus'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { damageRangeFromMidpoint } from '../game/combat/combatResolver'

const ATTRIBUTE_LABELS = {
  strength: 'Strength',
  agility: 'Agility',
  vitality: 'Vitality',
  spirit: 'Spirit',
} as const

// Collapsed by default so the Inventory grid below has room without scrolling —
// the full paper-doll (EquipmentPanel) covers the at-a-glance gear summary now
// that EquipmentBar has been removed; this panel is for players who want the
// full Class/Attributes/Derived-stats breakdown.
export default function StatsPanel() {
  const [expanded, setExpanded] = useState(false)

  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const attributes = useCharacterStore((state) => state.attributes)

  const equippedIds = useEquipmentStore((state) => state.equippedIds)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)

  const selectedClass = CLASS_DEFINITIONS[selectedClassId]
  const equipmentBonus = computeEquipmentBonus(equippedIds, items, templates)
  const derived = computeDerivedStats(attributes, equipmentBonus)

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between text-left"
      >
        <p className="text-sm font-medium text-slate-200">Character</p>
        <span className="text-xs text-slate-400">{expanded ? 'Hide ▲' : 'Show ▼'}</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Class</p>
            <p className="mt-1 text-sm text-slate-300">
              {selectedClass.displayName} — {selectedClass.realGameName}
            </p>
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
                <dd>
                  {(() => {
                    const { min, max } = damageRangeFromMidpoint(derived.physicalAttack)
                    return `${min}-${max}`
                  })()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Magic Attack</dt>
                <dd>
                  {(() => {
                    const { min, max } = damageRangeFromMidpoint(derived.magicAttack)
                    return `${min}-${max}`
                  })()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Attack Speed</dt>
                <dd>{derived.attackSpeed.toFixed(1)}/s</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Physical Defense</dt>
                <dd>{derived.physicalDefense}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Magic Defense</dt>
                <dd>{derived.magicDefense}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Dexterity</dt>
                <dd>{derived.dodge}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[11px] text-slate-500">Dexterity both helps you dodge attacks and makes your own attacks land more often.</p>
          </div>
        </div>
      )}
    </div>
  )
}
