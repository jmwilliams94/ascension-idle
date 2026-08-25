import type { ClassId } from '../stats/classes'

// First entry in a class-specific active-skill system (2026-10, see
// CLAUDE.combat-and-loot.md's "Confirmed future design" note this
// implements) — an equipped skill *replaces* the regular auto-attack rather
// than firing alongside it (unlike Hunter's on-use, Row-Combat-only
// Multi-Shot). Leveling per skill (a magic-level 0-4 ladder, each with its
// own cost/effect/required-level) is explicitly deferred — every skill here
// is its level-0 row only.
export type SkillId = 'thunder'

export interface SkillDefinition {
  id: SkillId
  displayName: string
  classId: ClassId
  description: string
  requiredLevel: number
  // Mana cost per cast. Enforced against a real currentPlayerMp/maxPlayerMp
  // pool (useCombatStore) — the first thing in this game to actually drain
  // MP; Mana potions were shipped inert ahead of this (see
  // CLAUDE.inventory-and-equipment.md).
  mpCost: number
  // Flat magic damage added on top of derived.magicAttack while this skill
  // is the active attack — sourced from Classic Conquer Wiki's Taoist
  // "Thunder" spell, Magic Level 0 row (Cost 1MP, Effects 7, Hit Rate 100,
  // Char Level 1). Per-level scaling (Magic Level 1-4) intentionally not
  // modeled yet.
  effectDamage: number
  // Replaces derived.attackSpeed's 1000ms interval while equipped — same
  // baseline for this first skill (no sourced cast-time data), but kept as
  // its own field per skill since future skills may differ.
  attackIntervalMs: number
}

export const SKILL_TYPES: Record<SkillId, SkillDefinition> = {
  thunder: {
    id: 'thunder',
    displayName: 'Thunder',
    classId: 'wuxia',
    description: 'A bolt of magic lightning. Replaces your regular attack with a Spirit-scaled Thunder strike.',
    requiredLevel: 1,
    mpCost: 1,
    effectDamage: 7,
    attackIntervalMs: 1000,
  },
}

export const SKILLS_BY_CLASS: Record<ClassId, SkillId[]> = {
  hunter: [],
  'twin-soul': [],
  wuxia: ['thunder'],
  juggernaut: [],
}
