import { useDailyQuestsStore } from '../game/dailyQuests/useDailyQuestsStore'
import { useDailyQuestsModalStore } from '../game/dailyQuests/useDailyQuestsModalStore'
import { isQuestClaimable } from '../game/dailyQuests/dailyQuestHelpers'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useEquipmentStore } from '../game/items/useEquipmentStore'

// Fixed floating button, bottom-right corner — same visual family/positioning
// pattern as UnclaimedLootBadge.tsx (which sits bottom-left), just mirrored to
// the opposite corner so the two don't collide.
//
// The button itself is always visible/clickable — it's the only entry point
// into the Daily Quests panel, so hiding it whenever nothing's claimable
// would make in-progress quests unreachable, not just unadvertised. Only the
// count bubble is conditional on claimableCount > 0 (2026-09-06, requested by
// the user after this exact confusion: a character whose remaining quests
// were still in progress, not actually claimable, looked like it had no
// dailies at all). Always mounted regardless, same as before — avoids
// popping a brand-new `position: fixed` element into the DOM after load,
// which iOS Safari mishandles for other already-fixed siblings on the page.
export default function DailyQuestBadge() {
  const quests = useDailyQuestsStore((state) => state.quests)
  const openModal = useDailyQuestsModalStore((state) => state.openModal)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const isEquipped = useEquipmentStore((state) => state.isEquipped)

  // Count of quests actually claimable right now (requested by the user) —
  // not just "not yet claimed", which would also count quests still in
  // progress. quality_order counts as claimable only while the character
  // actually owns a qualifying item (see isQuestClaimable).
  const claimableCount = quests.filter((quest) => isQuestClaimable(quest, items, templates, isEquipped)).length

  return (
    <button
      type="button"
      onClick={openModal}
      aria-label={
        claimableCount > 0
          ? `${claimableCount} daily quest${claimableCount === 1 ? '' : 's'} ready to claim — tap to review`
          : 'Daily quests — tap to review'
      }
      className="fixed bottom-24 right-3 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 bg-slate-950 text-2xl leading-none shadow-lg shadow-black/50 hover:bg-slate-900 lg:bottom-4"
    >
      <span className="leading-none">❗</span>
      {claimableCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-900 bg-slate-300 px-1 text-[10px] font-bold text-slate-950">
          {claimableCount}
        </span>
      )}
    </button>
  )
}
