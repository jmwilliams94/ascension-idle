// PLACEHOLDER arrow roster — prices, stack sizes, and effects are unresolved per
// CLAUDE.md, no real reference data yet. Only Hunter uses these.
export type ArrowTypeId = 'iron' | 'lucky' | 'speed'

export interface ArrowTypeDef {
  id: ArrowTypeId
  displayName: string
  price: number
  description: string
  // Max arrows a single stack of this type can hold. A purchase tops up existing
  // non-full stacks of the same type before creating new ones.
  stackSize: number
}

// PLACEHOLDER bonus magnitudes, unresolved per CLAUDE.md. Not wired into actual drop
// chance / attack speed calculations yet — this step is the arrow/ammo economy and
// gating itself; hooking these bonuses into the drop roll and derivedStats is a
// separate follow-up.
export const LUCKY_ARROW_DROP_BONUS_PLACEHOLDER = 0.02
export const SPEED_ARROW_ATTACK_SPEED_BONUS_PLACEHOLDER = 0.1

export const ARROW_TYPES: Record<ArrowTypeId, ArrowTypeDef> = {
  iron: {
    id: 'iron',
    displayName: 'Iron Arrow',
    price: 1,
    description: 'Standard ammo, no bonus effect.',
    stackSize: 500,
  },
  lucky: {
    id: 'lucky',
    displayName: 'Lucky Arrow',
    price: 3,
    description: `+${Math.round(LUCKY_ARROW_DROP_BONUS_PLACEHOLDER * 100)}% gear drop chance while equipped (placeholder).`,
    stackSize: 50,
  },
  speed: {
    id: 'speed',
    displayName: 'Speed Arrow',
    price: 3,
    description: `+${Math.round(SPEED_ARROW_ATTACK_SPEED_BONUS_PLACEHOLDER * 100)}% attack speed while equipped (placeholder).`,
    stackSize: 5000,
  },
}

export const ARROW_TYPE_ORDER: ArrowTypeId[] = ['iron', 'lucky', 'speed']
