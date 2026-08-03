// Zone 1 (Windhollow) per-monster Kill Count gear rewards (2026-08-03,
// confirmed with the user) — the first real per-monster tier content (Stage
// 1 shipped with one uniform placeholder reward only). Display-only mirror
// of the real grant logic in resolve-combat/index.ts's own
// MONSTER_GEAR_REWARDS — keep in sync. The actual item grant only ever
// happens server-side; this file only feeds AchievementsPanel's tooltip
// text, so a player can see what they're working toward.
export interface MonsterGearReward {
  templateName: string
  slotLabel: string
  killsRequired: number
}

export const MONSTER_GEAR_REWARDS: Record<string, MonsterGearReward> = {
  quailwing: { templateName: 'Fawnhide Coat', slotLabel: 'Armor', killsRequired: 1000 },
  'mourning-dove': { templateName: "Ranger's Bow", slotLabel: 'Weapon', killsRequired: 1000 },
  redbreast: { templateName: 'Pewter Ring', slotLabel: 'Ring', killsRequired: 1000 },
  warshade: { templateName: 'Twine Necklace', slotLabel: 'Necklace', killsRequired: 1000 },
  'grim-specter': { templateName: 'Padded Boots', slotLabel: 'Boots', killsRequired: 1000 },
}
