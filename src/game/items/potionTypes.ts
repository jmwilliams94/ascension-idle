// Original HP/Mana potion roster, independently designed for this game's own
// (currently flat, non-level-scaling — see derivedStats.ts) HP/MP pools.
// Pacing shape (8 tiers, price growing faster than heal at high tiers,
// decreasing cost-efficiency per tier) is loosely modeled on Conquer
// Online's Pharmacist NPC roster (local-only research notes:
// reference/conquer-items/pharmacist.md, gitignored) — names and every
// number here are freshly invented/computed, not copied, per this project's
// established "pattern not copy" methodology. All prices/heal amounts are
// PLACEHOLDERS, unresolved per CLAUDE.md like every other economy number.
export type PotionTypeId =
  | 'sprigroot_tonic'
  | 'verdant_balm'
  | 'emberleaf_draught'
  | 'ironbark_elixir'
  | 'stormroot_brew'
  | 'duskflame_panacea'
  | 'skyfire_elixir'
  | 'wyrmheart_draught'
  | 'mossglow_tonic'
  | 'whisperleaf_draught'
  | 'moonpetal_elixir'
  | 'starlight_brew'
  | 'emberwind_panacea'
  | 'nightbloom_draught'
  | 'voidglass_elixir'
  | 'astral_draught'

export interface PotionTypeDef {
  id: PotionTypeId
  displayName: string
  kind: 'hp' | 'mp'
  // Flat amount restored on Use. For 'mp' potions this is currently inert —
  // nothing in the game consumes MP yet (no ability/skill system exists), so
  // Use is disabled in the UI rather than faking an effect — see
  // usePotionStore.usePotion and InventoryPanel's potion detail card.
  healAmount: number
  price: number
  description: string
  // Max potions a single stack of this type can hold — a purchase tops up
  // existing non-full stacks of the same type before creating new ones, same
  // convention as ArrowTypeDef.stackSize.
  stackSize: number
  requiredLevel: number
}

export const POTION_TYPES: Record<PotionTypeId, PotionTypeDef> = {
  sprigroot_tonic: {
    id: 'sprigroot_tonic',
    displayName: 'Sprigroot Tonic',
    kind: 'hp',
    healAmount: 25,
    price: 3,
    description: 'Restores 25 HP.',
    stackSize: 20,
    requiredLevel: 1,
  },
  verdant_balm: {
    id: 'verdant_balm',
    displayName: 'Verdant Balm',
    kind: 'hp',
    healAmount: 45,
    price: 6,
    description: 'Restores 45 HP.',
    stackSize: 20,
    requiredLevel: 20,
  },
  emberleaf_draught: {
    id: 'emberleaf_draught',
    displayName: 'Emberleaf Draught',
    kind: 'hp',
    healAmount: 75,
    price: 12,
    description: 'Restores 75 HP.',
    stackSize: 20,
    requiredLevel: 40,
  },
  ironbark_elixir: {
    id: 'ironbark_elixir',
    displayName: 'Ironbark Elixir',
    kind: 'hp',
    healAmount: 115,
    price: 20,
    description: 'Restores 115 HP.',
    stackSize: 20,
    requiredLevel: 60,
  },
  stormroot_brew: {
    id: 'stormroot_brew',
    displayName: 'Stormroot Brew',
    kind: 'hp',
    healAmount: 160,
    price: 35,
    description: 'Restores 160 HP.',
    stackSize: 20,
    requiredLevel: 80,
  },
  duskflame_panacea: {
    id: 'duskflame_panacea',
    displayName: 'Duskflame Panacea',
    kind: 'hp',
    healAmount: 220,
    price: 55,
    description: 'Restores 220 HP.',
    stackSize: 20,
    requiredLevel: 95,
  },
  skyfire_elixir: {
    id: 'skyfire_elixir',
    displayName: 'Skyfire Elixir',
    kind: 'hp',
    healAmount: 300,
    price: 85,
    description: 'Restores 300 HP.',
    stackSize: 20,
    requiredLevel: 110,
  },
  wyrmheart_draught: {
    id: 'wyrmheart_draught',
    displayName: 'Wyrmheart Draught',
    kind: 'hp',
    healAmount: 400,
    price: 130,
    description: 'Restores 400 HP.',
    stackSize: 20,
    requiredLevel: 125,
  },
  mossglow_tonic: {
    id: 'mossglow_tonic',
    displayName: 'Mossglow Tonic',
    kind: 'mp',
    healAmount: 8,
    price: 3,
    description: 'Restores 8 MP.',
    stackSize: 20,
    requiredLevel: 1,
  },
  whisperleaf_draught: {
    id: 'whisperleaf_draught',
    displayName: 'Whisperleaf Draught',
    kind: 'mp',
    healAmount: 15,
    price: 6,
    description: 'Restores 15 MP.',
    stackSize: 20,
    requiredLevel: 20,
  },
  moonpetal_elixir: {
    id: 'moonpetal_elixir',
    displayName: 'Moonpetal Elixir',
    kind: 'mp',
    healAmount: 25,
    price: 12,
    description: 'Restores 25 MP.',
    stackSize: 20,
    requiredLevel: 40,
  },
  starlight_brew: {
    id: 'starlight_brew',
    displayName: 'Starlight Brew',
    kind: 'mp',
    healAmount: 40,
    price: 20,
    description: 'Restores 40 MP.',
    stackSize: 20,
    requiredLevel: 60,
  },
  emberwind_panacea: {
    id: 'emberwind_panacea',
    displayName: 'Emberwind Panacea',
    kind: 'mp',
    healAmount: 55,
    price: 35,
    description: 'Restores 55 MP.',
    stackSize: 20,
    requiredLevel: 80,
  },
  nightbloom_draught: {
    id: 'nightbloom_draught',
    displayName: 'Nightbloom Draught',
    kind: 'mp',
    healAmount: 75,
    price: 55,
    description: 'Restores 75 MP.',
    stackSize: 20,
    requiredLevel: 95,
  },
  voidglass_elixir: {
    id: 'voidglass_elixir',
    displayName: 'Voidglass Elixir',
    kind: 'mp',
    healAmount: 100,
    price: 85,
    description: 'Restores 100 MP.',
    stackSize: 20,
    requiredLevel: 110,
  },
  astral_draught: {
    id: 'astral_draught',
    displayName: 'Astral Draught',
    kind: 'mp',
    healAmount: 130,
    price: 130,
    description: 'Restores 130 MP.',
    stackSize: 20,
    requiredLevel: 125,
  },
}

// Ascending by requiredLevel.
export const HP_POTION_ORDER: PotionTypeId[] = [
  'sprigroot_tonic',
  'verdant_balm',
  'emberleaf_draught',
  'ironbark_elixir',
  'stormroot_brew',
  'duskflame_panacea',
  'skyfire_elixir',
  'wyrmheart_draught',
]

export const MP_POTION_ORDER: PotionTypeId[] = [
  'mossglow_tonic',
  'whisperleaf_draught',
  'moonpetal_elixir',
  'starlight_brew',
  'emberwind_panacea',
  'nightbloom_draught',
  'voidglass_elixir',
  'astral_draught',
]
