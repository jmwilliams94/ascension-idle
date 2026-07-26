import type { Attributes } from './classes'

// PLACEHOLDER base pools before any attribute points are applied — not sourced,
// just enough to make HP/MP non-zero at 0 stats.
const BASE_HP = 50
const BASE_MP = 20

// PLACEHOLDER scaling multipliers. The real Physical/Magic Attack formulas are
// unresolved per CLAUDE.md — these are stand-ins so the math has something to show.
const PHYSICAL_ATTACK_PER_STRENGTH = 2
const MAGIC_ATTACK_PER_SPIRIT = 2

// Attack speed is fixed and NOT derived from any attribute. It will eventually come
// from the equipped weapon type's innate frequency. Do not add Agility scaling here —
// per confirmed design, Agility affects accuracy/dodge, not attack speed or damage.
export const BASE_ATTACK_SPEED = 1.0

export interface DerivedStats {
  hp: number
  mp: number
  physicalAttack: number
  magicAttack: number
  attackSpeed: number
}

export function computeDerivedStats(attributes: Attributes): DerivedStats {
  const { strength, agility, vitality, spirit } = attributes

  const hp = BASE_HP + vitality * 24 + strength * 3 + agility * 3 + spirit * 3
  const mp = BASE_MP + spirit * 5
  const physicalAttack = strength * PHYSICAL_ATTACK_PER_STRENGTH
  const magicAttack = spirit * MAGIC_ATTACK_PER_SPIRIT

  return {
    hp,
    mp,
    physicalAttack,
    magicAttack,
    attackSpeed: BASE_ATTACK_SPEED,
  }
}
