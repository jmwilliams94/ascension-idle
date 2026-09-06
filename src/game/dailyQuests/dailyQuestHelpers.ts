import type { DailyQuest } from './useDailyQuestsStore'
import type { ItemInstance } from '../items/useInventoryStore'
import type { ItemTemplate } from '../items/useItemTemplatesStore'

const QUALIFYING_TIERS = ['tempered', 'infused', 'radiant', 'ascended']

export function questTarget(quest: DailyQuest): number {
  if (quest.type === 'kill_count') return Number(quest.target.required_kills ?? 0)
  if (quest.type === 'world_boss_attacks') return Number(quest.target.required_attacks ?? 0)
  return 1
}

// The set of the character's own inventory items that would satisfy a
// quality_order quest's slot_type + quality-tier requirement right now —
// shared between DailyQuestsModal's picker (needs the actual list) and
// DailyQuestBadge (only needs to know whether the list is non-empty), so the
// eligibility rule can't drift between the two.
export function eligibleQualityOrderItems(
  quest: DailyQuest,
  items: ItemInstance[],
  templates: ItemTemplate[],
  isEquipped: (itemId: string) => boolean,
): ItemInstance[] {
  const slotType = String(quest.target.slot_type ?? '')
  return items.filter((item) => {
    if (item.location !== 'inventory' || isEquipped(item.id)) return false
    if (!QUALIFYING_TIERS.includes(item.quality_tier)) return false
    const template = templates.find((entry) => entry.id === item.template_id)
    return template?.slot_type === slotType
  })
}

// "Claimable" means the Claim button would actually succeed right now — not
// just "not yet claimed" (which also includes quests still in progress).
// quality_order has no progress counter at all (it's validated live against
// Inventory at claim time), so its claimability is "do you currently own a
// qualifying item" rather than a progress/target comparison.
export function isQuestClaimable(
  quest: DailyQuest,
  items: ItemInstance[],
  templates: ItemTemplate[],
  isEquipped: (itemId: string) => boolean,
): boolean {
  if (quest.claimed) return false
  if (quest.type === 'quality_order') return eligibleQualityOrderItems(quest, items, templates, isEquipped).length > 0
  return quest.progress >= questTarget(quest)
}
