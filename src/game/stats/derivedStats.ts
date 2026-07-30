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
  // Mitigates incoming monster damage (see combatResolver.ts's
  // resolvePhysicalDamage) — gear-only for now (necklace/hat/coat), closing a
  // previously-documented gap now that armor slots are actually functional.
  physicalDefense: number
  // Chance to fully avoid an incoming monster attack (see combatResolver.ts's
  // rollIsHit) — confirmed design direction (Agility governs dodge), newly
  // wired up alongside boots' own dodge stat. PLACEHOLDER weighting, like
  // everything else in this game's combat math.
  dodge: number
}

// Flat stat bonuses from the currently equipped item(s) — stacks on top of the
// attribute-derived values. See game/items/equipmentBonus.ts.
export interface EquipmentBonus {
  physicalAttack?: number
  magicAttack?: number
  physicalDefense?: number
  dodge?: number
}

export function computeDerivedStats(attributes: Attributes, equipmentBonus: EquipmentBonus = {}): DerivedStats {
  const { strength, agility, vitality, spirit } = attributes

  const hp = BASE_HP + vitality * 24 + strength * 3 + agility * 3 + spirit * 3
  const mp = BASE_MP + spirit * 5
  const physicalAttack = strength * PHYSICAL_ATTACK_PER_STRENGTH + (equipmentBonus.physicalAttack ?? 0)
  const magicAttack = spirit * MAGIC_ATTACK_PER_SPIRIT + (equipmentBonus.magicAttack ?? 0)
  const physicalDefense = equipmentBonus.physicalDefense ?? 0
  // PLACEHOLDER: 1 dodge per Agility point, plus boots' own dodge stat — the
  // first time Agility actually feeds into anything, per the confirmed
  // "Agility governs accuracy/dodge" design that had nothing wired to it yet.
  const dodge = agility * 1 + (equipmentBonus.dodge ?? 0)

  return {
    hp,
    mp,
    physicalAttack,
    magicAttack,
    attackSpeed: BASE_ATTACK_SPEED,
    physicalDefense,
    dodge,
  }
}
