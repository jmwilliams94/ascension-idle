export type AttributeKey = 'strength' | 'agility' | 'vitality' | 'spirit'

export type Attributes = Record<AttributeKey, number>

export type ClassId = 'juggernaut' | 'twin-soul' | 'wuxia' | 'hunter'

export interface ClassDefinition {
  id: ClassId
  displayName: string
  // Real-game class this maps to, per CLAUDE.md's confirmed mapping.
  realGameName: string
  // Level required to select this class. Hunter is the only starter class; everyone
  // else unlocks at 40. There's no leveling system yet, so this just gates the
  // class-select UI for now.
  unlockLevel: number
  // PLACEHOLDER: attack range in tiles (Chebyshev distance). Real per-class/per-weapon
  // ranges are unresolved per CLAUDE.md — these are confirmed design values (not sourced
  // from real game data): melee classes are adjacent-only, Hunter and Wuxia are ranged.
  attackRange: number
}

export const CLASS_DEFINITIONS: Record<ClassId, ClassDefinition> = {
  juggernaut: {
    id: 'juggernaut',
    displayName: 'Juggernaut',
    realGameName: 'Warrior',
    unlockLevel: 40,
    attackRange: 1,
  },
  'twin-soul': {
    id: 'twin-soul',
    displayName: 'Twin-soul',
    realGameName: 'Trojan',
    unlockLevel: 40,
    attackRange: 1,
  },
  wuxia: {
    id: 'wuxia',
    displayName: 'Wuxia',
    realGameName: 'Taoist',
    unlockLevel: 40,
    attackRange: 8,
  },
  hunter: {
    id: 'hunter',
    displayName: 'Hunter',
    realGameName: 'Archer',
    unlockLevel: 1,
    attackRange: 10,
  },
}

export const CLASS_ORDER: ClassId[] = ['hunter', 'juggernaut', 'twin-soul', 'wuxia']

type AttributeAnchor = [level: number, attrs: Attributes]

// Auto-allotment of attribute points by level (confirmed with the user,
// 2026-08-02) — attributes are now a pure function of (class, level) via
// getAttributesForLevel below, not a fixed value set once at character
// creation. Anchored exactly at this game's own confirmed promotion tiers
// (see the Progression section's "Promotion tiers" note) — the user
// confirmed these stat increments ARE the promotion-tier requirements
// themselves, i.e. auto-allotment exists specifically so a character's
// attributes meet each tier's gate automatically, not an independent curve
// that happens to share the same level numbers.
//
// Sourced (2026-08-02) from conquer-online.fandom.com/wiki/Attribute_Points
// and a companion table with the actual per-class/per-tier numbers (see
// CLAUDE.md's Stats section for the full research writeup and sourcing
// caveats — the source table was titled "Reborn X," and this project has no
// Rebirth mechanic, but the level-1 values match this file's own
// already-confirmed starting attributes exactly, which is why the table is
// treated as the ordinary first-life auto-allotment curve rather than
// something reborn-specific). 1/15/40/70/100/110 are the real sourced
// anchors; 120/130 are NOT sourced — no reference data exists past level
// 110, so those two just continue the 100→110 per-level rate in a straight
// line (disclosed extrapolation, not real data, revisit if better numbers
// surface).
//
// Between anchors, getAttributesForLevel interpolates linearly (not
// geometrically like the EXP curve in useProgressionStore.ts) — several
// attributes are pinned at exactly 0 for a whole class (e.g. Warrior/
// Trojan's Spirit, Taoist's Strength), which a log-scale interpolation
// can't handle at all, and the source data itself doesn't show exponential
// growth the way EXP-per-level does.
const WARRIOR_TROJAN_SHARED_ANCHORS: AttributeAnchor[] = [
  [1, { strength: 5, agility: 2, vitality: 3, spirit: 0 }],
  [15, { strength: 28, agility: 10, vitality: 14, spirit: 0 }],
]

const WARRIOR_ANCHORS: AttributeAnchor[] = [
  ...WARRIOR_TROJAN_SHARED_ANCHORS,
  [40, { strength: 80, agility: 25, vitality: 22, spirit: 0 }],
  [70, { strength: 140, agility: 45, vitality: 32, spirit: 0 }],
  [100, { strength: 205, agility: 60, vitality: 42, spirit: 0 }],
  [110, { strength: 225, agility: 65, vitality: 47, spirit: 0 }],
  [120, { strength: 245, agility: 70, vitality: 52, spirit: 0 }],
  [130, { strength: 265, agility: 75, vitality: 57, spirit: 0 }],
]

const TROJAN_ANCHORS: AttributeAnchor[] = [
  ...WARRIOR_TROJAN_SHARED_ANCHORS,
  [40, { strength: 60, agility: 25, vitality: 25, spirit: 0 }],
  [70, { strength: 110, agility: 42, vitality: 45, spirit: 0 }],
  [100, { strength: 155, agility: 60, vitality: 92, spirit: 0 }],
  [110, { strength: 170, agility: 65, vitality: 100, spirit: 0 }],
  [120, { strength: 185, agility: 70, vitality: 108, spirit: 0 }],
  [130, { strength: 200, agility: 75, vitality: 116, spirit: 0 }],
]

const TAOIST_ANCHORS: AttributeAnchor[] = [
  [1, { strength: 0, agility: 2, vitality: 3, spirit: 5 }],
  [15, { strength: 0, agility: 10, vitality: 17, spirit: 25 }],
  [40, { strength: 0, agility: 25, vitality: 22, spirit: 80 }],
  [70, { strength: 0, agility: 45, vitality: 32, spirit: 140 }],
  [100, { strength: 0, agility: 60, vitality: 42, spirit: 205 }],
  [110, { strength: 0, agility: 65, vitality: 47, spirit: 225 }],
  [120, { strength: 0, agility: 70, vitality: 52, spirit: 245 }],
  [130, { strength: 0, agility: 75, vitality: 57, spirit: 265 }],
]

const ARCHER_ANCHORS: AttributeAnchor[] = [
  [1, { strength: 3, agility: 5, vitality: 2, spirit: 0 }],
  [15, { strength: 12, agility: 30, vitality: 5, spirit: 0 }],
  [40, { strength: 25, agility: 90, vitality: 12, spirit: 0 }],
  [70, { strength: 45, agility: 150, vitality: 22, spirit: 0 }],
  [100, { strength: 60, agility: 215, vitality: 32, spirit: 0 }],
  [110, { strength: 68, agility: 235, vitality: 34, spirit: 0 }],
  [120, { strength: 76, agility: 255, vitality: 36, spirit: 0 }],
  [130, { strength: 84, agility: 275, vitality: 38, spirit: 0 }],
]

const ATTRIBUTE_ANCHORS: Record<ClassId, AttributeAnchor[]> = {
  juggernaut: WARRIOR_ANCHORS,
  'twin-soul': TROJAN_ANCHORS,
  wuxia: TAOIST_ANCHORS,
  hunter: ARCHER_ANCHORS,
}

// The auto-allotment curve above only applies for levels 1-130 (confirmed
// with the user) — this game's own future "Ascend" mechanic (return to
// level 15, keep gear/bonuses, max 2 ascensions — confirmed design, not yet
// built, see CLAUDE.md's Progression section) is explicitly out of scope
// here; this function has no notion of ascension count, it just maps
// (class, level) to attributes for a single 1-130 run.
export function getAttributesForLevel(classId: ClassId, level: number): Attributes {
  const anchors = ATTRIBUTE_ANCHORS[classId]
  const clampedLevel = Math.min(Math.max(level, anchors[0][0]), anchors[anchors.length - 1][0])

  for (let i = 0; i < anchors.length; i += 1) {
    const [anchorLevel, anchorAttrs] = anchors[i]

    if (clampedLevel === anchorLevel) {
      return { ...anchorAttrs }
    }

    if (clampedLevel < anchorLevel) {
      const [prevLevel, prevAttrs] = anchors[i - 1]
      const t = (clampedLevel - prevLevel) / (anchorLevel - prevLevel)
      return {
        strength: Math.round(prevAttrs.strength + (anchorAttrs.strength - prevAttrs.strength) * t),
        agility: Math.round(prevAttrs.agility + (anchorAttrs.agility - prevAttrs.agility) * t),
        vitality: Math.round(prevAttrs.vitality + (anchorAttrs.vitality - prevAttrs.vitality) * t),
        spirit: Math.round(prevAttrs.spirit + (anchorAttrs.spirit - prevAttrs.spirit) * t),
      }
    }
  }

  return { ...anchors[anchors.length - 1][1] }
}
