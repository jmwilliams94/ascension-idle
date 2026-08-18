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
  // Gear-only (Coats specifically, 2026-08-02 — see CLAUDE.md's Gear system
  // note on the reference-data audit that caught this stat being dropped
  // entirely from the original catalog). Inert like magicAttack: no monster
  // deals magic damage yet, so this has no combat effect — it exists ahead
  // of that mechanic, same "data exists ahead of the mechanic" precedent as
  // sockets/enchant/dodge before their own mechanics landed.
  magicDefense: number
  // Chance to fully avoid an incoming monster attack (see combatResolver.ts's
  // rollIsHit) — confirmed design direction (Agility governs dodge). Gear-side,
  // this is Boots-only (2026-08-02, split back apart from Dexterity below at
  // the user's request — Boots keep their own distinct evasion stat rather
  // than sharing one pooled number with Bows/Rings). PLACEHOLDER weighting,
  // like everything else in this game's combat math.
  dodge: number
  // Chance the player's own attack actually lands against monster Dodge (see
  // combatResolver.ts's rollAttackLands) — a separate stat from `dodge`
  // above, not a relabeling of it (confirmed with the user, 2026-08-02):
  // Dodge is Boots' own evasion stat, Dexterity is Bows'/Rings' own accuracy
  // stat, both still fed by the same Agility attribute but gear-boosted
  // independently by different slot types. PLACEHOLDER weighting.
  dexterity: number
  // Composition ("+N") bonus to physical/magic attack, kept split by type
  // (2026-08-26 — was one merged compositionAttackBonus field until Drake/
  // Ember gem bonuses needed to apply to their own type specifically) and
  // out of `physicalAttack`/`magicAttack` above, so callers computing
  // attackMidpoint can add each in *after* applying the account-wide attack
  // bonus %, not before (see equipmentBonus.ts's computeEquipmentBonus and
  // useCombatStore.runTick). Composition's defense/dodge bonus has no
  // equivalent account-wide multiplier, so it's already folded into
  // physicalDefense/magicDefense/dodge above.
  compositionPhysicalAttackBonus: number
  compositionMagicAttackBonus: number
  // Socketed Drake/Ember gem bonus %, summed across every equipped item's
  // sockets (2026-08-26, requested by the user — see gemCatalog.ts's
  // sumSocketedGemBonusPct). Applied as the final multiplier on physical/
  // magic attack respectively, after quality tier and composition are both
  // already folded in — see useCombatStore.runTick's attackMidpoint calc.
  drakeBonusPct: number
  emberBonusPct: number
  // Socketed Iris gem bonus % (Character EXP), same summing convention as
  // Drake/Ember above (2026-08-26) — kept as its own field rather than
  // merged into anything, since it's applied at the reward-computation site
  // (combatResolver.ts's expectedRewardPerAttack / resolve-combat/index.ts's
  // mirror) as the final multiplier on total EXP gained, not alongside
  // attack. Not mirrored in world-boss-attack — attacking the boss grants no
  // EXP at all, so there's nothing for this to multiply there.
  irisBonusPct: number
  // Enchantress "Bless" tab (2026-08-13, see gemCatalog.ts's BLESS_PCT_STEPS)
  // plus socketed Bastion Gems (2026-08-26, same effect, second source) —
  // flat % reduction applied to incoming monster damage, summed across every
  // equipped item's own blessPct AND socketed Bastion bonus into one
  // combined number. Consumed by useCombatStore.runTick via
  // combatResolver.ts's applyDamageReduction — client-only, same boundary as
  // the rest of incoming player damage (never simulated server-side, and the
  // World Boss never damages the player back at all, so neither source has
  // any server mirror).
  damageReductionPct: number
}

// Flat stat bonuses from the currently equipped item(s) — stacks on top of the
// attribute-derived values. See game/items/equipmentBonus.ts.
export interface EquipmentBonus {
  physicalAttack?: number
  magicAttack?: number
  physicalDefense?: number
  magicDefense?: number
  dodge?: number
  dexterity?: number
  compositionPhysicalAttackBonus?: number
  compositionMagicAttackBonus?: number
  drakeBonusPct?: number
  emberBonusPct?: number
  bastionBonusPct?: number
  irisBonusPct?: number
  // Enchantress HP bonus (see gemCatalog.ts's ENCHANT_HP_RANGE_BY_TIER,
  // item_instances.enchant) — summed flat across every equipped item, added
  // straight onto hp below same as the attribute-derived base, not scaled by
  // anything (no account-wide multiplier applies to it, unlike attack).
  enchantHpBonus?: number
  // Gear-granted flat HP (2026-08-18, Juggernaut Shield's "Life" stat —
  // base_stats.max_hp, scaled by quality tier like every other gear stat).
  // A separate additive field from enchantHpBonus above rather than merged
  // into it, since this one *does* scale with quality tier (scaledStat) while
  // Enchant's HP roll is a fixed value baked in at roll time — keeping them
  // separate avoids conflating two different scaling rules under one field.
  gearHpBonus?: number
  // Enchantress "Bless" bonus (see gemCatalog.ts's BLESS_PCT_STEPS,
  // item_instances.enchant.blessPct) — summed across every equipped item.
  blessDamageReductionPct?: number
}

export function computeDerivedStats(attributes: Attributes, equipmentBonus: EquipmentBonus = {}): DerivedStats {
  const { strength, agility, vitality, spirit } = attributes

  const hp =
    BASE_HP +
    vitality * 24 +
    strength * 3 +
    agility * 3 +
    spirit * 3 +
    (equipmentBonus.enchantHpBonus ?? 0) +
    (equipmentBonus.gearHpBonus ?? 0)
  const mp = BASE_MP + spirit * 5
  const physicalAttack = strength * PHYSICAL_ATTACK_PER_STRENGTH + (equipmentBonus.physicalAttack ?? 0)
  const magicAttack = spirit * MAGIC_ATTACK_PER_SPIRIT + (equipmentBonus.magicAttack ?? 0)
  const physicalDefense = equipmentBonus.physicalDefense ?? 0
  const magicDefense = equipmentBonus.magicDefense ?? 0
  // PLACEHOLDER: 1 dodge per Agility point, plus Boots' own dodge stat — the
  // first time Agility actually feeds into anything, per the confirmed
  // "Agility governs accuracy/dodge" design that had nothing wired to it yet.
  const dodge = agility * 1 + (equipmentBonus.dodge ?? 0)
  // PLACEHOLDER: same 1-per-Agility-point rate as dodge above (Agility governs
  // both, per the confirmed design), plus Bows'/Rings' own dexterity stat —
  // a separate gear-side pool from dodge's Boots-only one.
  const dexterity = agility * 1 + (equipmentBonus.dexterity ?? 0)

  return {
    hp,
    mp,
    physicalAttack,
    magicAttack,
    attackSpeed: BASE_ATTACK_SPEED,
    physicalDefense,
    magicDefense,
    dodge,
    dexterity,
    compositionPhysicalAttackBonus: equipmentBonus.compositionPhysicalAttackBonus ?? 0,
    compositionMagicAttackBonus: equipmentBonus.compositionMagicAttackBonus ?? 0,
    drakeBonusPct: equipmentBonus.drakeBonusPct ?? 0,
    emberBonusPct: equipmentBonus.emberBonusPct ?? 0,
    irisBonusPct: equipmentBonus.irisBonusPct ?? 0,
    damageReductionPct: (equipmentBonus.blessDamageReductionPct ?? 0) + (equipmentBonus.bastionBonusPct ?? 0),
  }
}
