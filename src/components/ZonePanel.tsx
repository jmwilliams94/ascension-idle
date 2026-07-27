import { ENEMY_SPAWNS, ENEMY_TYPES, ZONE_NAME } from '../game/zones/twincrossOutskirts'

const ROSTER = [...new Set(ENEMY_SPAWNS.map((spawn) => spawn.typeId))].map((typeId) => ENEMY_TYPES[typeId])

export default function ZonePanel() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-sm font-medium text-slate-200">{ZONE_NAME}</p>
      <p className="mt-1 text-xs text-slate-500">
        Placeholder zone name — final zone naming is still unresolved per CLAUDE.md.
      </p>

      <p className="mt-4 text-sm font-medium text-slate-200">Enemy roster</p>
      <ul className="mt-2 space-y-2 text-sm text-slate-400">
        {ROSTER.map((type) => (
          <li key={type.id} className="flex justify-between">
            <span>{type.displayName}</span>
            <span className="text-slate-500">{type.maxHp} HP</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
