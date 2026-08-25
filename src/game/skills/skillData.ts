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
  // is the active attack. Classic Conquer Wiki's Taoist "Thunder" spell,
  // Magic Level 0 row, lists Effects: 7 — but copied verbatim that made a
  // level-1 Wuxia with the starter Lucky Backsword 2-hit-kill Windhollow's
  // level-1 Quailwing (24 HP), reported as far too strong for a starting
  // zone. Recalibrated down to 1 (2026-08-27) so the same matchup lands a
  // reliable 3-hit kill instead — this game's own monster-HP curve isn't a
  // 1:1 match for the source game's, so the wiki's flat value was never
  // going to transfer directly (same "pattern not copy" precedent as every
  // other reference-derived number in this project). Per-level scaling
  // (Magic Level 1-4) intentionally not modeled yet.
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
    effectDamage: 1,
    attackIntervalMs: 1000,
  },
}

export const SKILLS_BY_CLASS: Record<ClassId, SkillId[]> = {
  hunter: [],
  'twin-soul': [],
  wuxia: ['thunder'],
  juggernaut: [],
}
