import { CLASS_DEFINITIONS, CLASS_ORDER } from '../game/stats/classes'
import { computeDerivedStats } from '../game/stats/derivedStats'
import { useCharacterStore } from '../game/stats/useCharacterStore'

// There's no leveling system yet, so this is a stand-in "current level" purely to
// gate class selection against each class's unlockLevel (Wuxia unlocks at 30).
const CURRENT_LEVEL = 1

const ATTRIBUTE_LABELS = {
  strength: 'Strength',
  agility: 'Agility',
  vitality: 'Vitality',
  spirit: 'Spirit',
} as const

export default function StatsPanel() {
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const attributes = useCharacterStore((state) => state.attributes)
  const selectClass = useCharacterStore((state) => state.selectClass)

  const selectedClass = CLASS_DEFINITIONS[selectedClassId]
  const derived = computeDerivedStats(attributes)

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <div>
        <p className="text-sm font-medium text-slate-200">Class</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {CLASS_ORDER.map((classId) => {
            const classDef = CLASS_DEFINITIONS[classId]
            const locked = CURRENT_LEVEL < classDef.unlockLevel
            const isSelected = classId === selectedClassId

            return (
              <button
                key={classId}
                type="button"
                disabled={locked}
                onClick={() => selectClass(classId)}
                title={locked ? `Unlocks at level ${classDef.unlockLevel}` : undefined}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  locked
                    ? 'cursor-not-allowed border-slate-800 text-slate-600'
                    : isSelected
                      ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                {classDef.displayName}
                {locked ? ` (Locked, Lv. ${classDef.unlockLevel})` : ''}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {selectedClass.displayName} — {selectedClass.realGameName}
          {selectedClass.placeholder ? ' (starting attributes are a placeholder, unresolved)' : ''}
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
