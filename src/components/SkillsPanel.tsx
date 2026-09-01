import { useState } from 'react'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useSkillsStore } from '../game/skills/useSkillsStore'
import { SKILL_TYPES, SKILLS_BY_CLASS } from '../game/skills/skillData'

type SkillSubTab = 'skills' | 'passives'

const SUB_TAB_BUTTON_CLASS = 'relative w-full rounded-lg px-3 py-1.5 text-xs font-medium'

// First entry in a class-specific active-skill system (2026-10) — an
// equipped skill *replaces* the character's regular auto-attack rather than
// firing alongside it, on its own attack-speed interval (see
// src/game/skills/skillData.ts, useCombatStore.runTick's activeSkill
// branch). Skills/Passives sub-tab split mirrors the existing in-page
// sub-nav convention (CombatPage's Hunting/Mining/Events,
// ShopPanel's Weapons/Armor/... — .btn-gold/.btn-gold-active). Passives has
// no content yet — a stub tab so the split exists from day one rather than
// bolting it on later.
export default function SkillsPanel() {
  const [subTab, setSubTab] = useState<SkillSubTab>('skills')
  const selectedClassId = useCharacterStore((state) => state.selectedClassId)
  const level = useProgressionStore((state) => state.level)
  const equippedSkillId = useSkillsStore((state) => state.equippedSkillId)
  const equipSkill = useSkillsStore((state) => state.equipSkill)
  const unequipSkill = useSkillsStore((state) => state.unequipSkill)

  const skillIds = SKILLS_BY_CLASS[selectedClassId]

  return (
    <AscensionCard title="Skills">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSubTab('skills')}
          className={`${SUB_TAB_BUTTON_CLASS} ${subTab === 'skills' ? 'btn-gold-active' : 'btn-gold'}`}
        >
          Skills
        </button>
        <button
          type="button"
          onClick={() => setSubTab('passives')}
          className={`${SUB_TAB_BUTTON_CLASS} ${subTab === 'passives' ? 'btn-gold-active' : 'btn-gold'}`}
        >
          Passives
        </button>
      </div>

      {subTab === 'skills' && (
        <div className="mt-4 space-y-3">
          {skillIds.length === 0 && (
            <p className="text-xs text-slate-300">No skills available for this class yet.</p>
          )}
          {skillIds.map((skillId) => {
            const skill = SKILL_TYPES[skillId]
            const isEquipped = equippedSkillId === skillId
            const levelLocked = level < skill.requiredLevel

            return (
              <div key={skillId} className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-200">{skill.displayName}</p>
                    <p className="mt-0.5 text-xs text-slate-300">{skill.description}</p>
                    <p className="mt-1.5 text-xs text-sky-300">
                      {skill.effectDamage} bonus Magic Attack · {skill.mpCost} MP · {(1000 / skill.attackIntervalMs).toFixed(1)}/s
                    </p>
                    {levelLocked && <p className="mt-1 text-xs text-rose-400">Requires level {skill.requiredLevel}</p>}
                  </div>
                  <Button
                    variant={isEquipped ? 'secondary' : 'primary'}
                    className="shrink-0"
                    disabled={levelLocked}
                    onClick={() => (isEquipped ? unequipSkill() : equipSkill(skillId))}
                  >
                    {isEquipped ? 'Unequip' : 'Equip'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {subTab === 'passives' && (
        <p className="mt-4 text-xs text-slate-300">Passives are coming soon.</p>
      )}
    </AscensionCard>
  )
}
