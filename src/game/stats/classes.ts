export type AttributeKey = 'strength' | 'agility' | 'vitality' | 'spirit'

export type Attributes = Record<AttributeKey, number>

export type ClassId = 'juggernaut' | 'twin-soul' | 'wuxia' | 'hunter'

export interface ClassDefinition {
  id: ClassId
  displayName: string
  // Real-game class this maps to, per CLAUDE.md's confirmed mapping.
  realGameName: string
  baseAttributes: Attributes
  // Level required to select this class. Wuxia unlocks at 30; everyone else starts open.
  // There's no leveling system yet, so this just gates the class-select UI for now.
  unlockLevel: number
  // True if these starting attributes are an unresolved placeholder guess, not sourced data.
  placeholder?: boolean
}

export const CLASS_DEFINITIONS: Record<ClassId, ClassDefinition> = {
  juggernaut: {
    id: 'juggernaut',
    displayName: 'Juggernaut',
    realGameName: 'Warrior',
    baseAttributes: { strength: 5, agility: 2, vitality: 3, spirit: 0 },
    unlockLevel: 1,
  },
  'twin-soul': {
    id: 'twin-soul',
    displayName: 'Twin-soul',
    realGameName: 'Trojan',
    baseAttributes: { strength: 5, agility: 2, vitality: 3, spirit: 0 },
    unlockLevel: 1,
  },
  wuxia: {
    id: 'wuxia',
    displayName: 'Wuxia',
    realGameName: 'Taoist',
    baseAttributes: { strength: 0, agility: 2, vitality: 3, spirit: 5 },
    unlockLevel: 30,
  },
  hunter: {
    id: 'hunter',
    displayName: 'Hunter',
    realGameName: 'Archer',
    // PLACEHOLDER: real starting attributes for Archer are unresolved per CLAUDE.md.
    // This is a rough ranged/agility-leaning guess, not sourced data.
    baseAttributes: { strength: 3, agility: 5, vitality: 2, spirit: 0 },
    unlockLevel: 1,
    placeholder: true,
  },
}

export const CLASS_ORDER: ClassId[] = ['juggernaut', 'twin-soul', 'hunter', 'wuxia']
