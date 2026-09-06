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
// Always mounted (hidden via CSS, not a `return null`) — unlike
// UnclaimedLootBadge, which really does come and go rarely. This one starts
// hidden on every page load (no quest data yet) and then almost always
// becomes visible a moment later once `ensure` resolves, which means a
// conditional-render version pops a brand-new `position: fixed` element into
// the DOM shortly after every single refresh — exactly the kind of mid-load
// layout change iOS Safari is known to mishandle for OTHER already-fixed
// siblings on the page. Reported 2026-09-06: MobileBottomNav's own
// position:fixed came unstuck on scroll right after a fresh app refresh,
// which fits this mounting pattern far better than the earlier (disproven,
// see git history) backdrop-blur theory — the nav was already fully painted
// and fixed before this badge's data ever loaded, so inserting a new fixed
// sibling into that already-scrolling page is the more likely trigger.
// Keeping the button in the DOM from first paint (just invisible) removes
// that insertion entirely.
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
  const visible = claimableCount > 0

  return (
    <button
      type="button"
      onClick={openModal}
      disabled={!visible}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      aria-label={`${claimableCount} daily quest${claimableCount === 1 ? '' : 's'} ready to claim — tap to review`}
      className={`fixed bottom-24 right-3 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 bg-slate-950 text-2xl leading-none shadow-lg shadow-black/50 hover:bg-slate-900 lg:bottom-4 ${
        visible ? '' : 'invisible pointer-events-none opacity-0'
      }`}
    >
      <span className="leading-none">❗</span>
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-900 bg-slate-300 px-1 text-[10px] font-bold text-slate-950">
        {claimableCount}
      </span>
    </button>
  )
}
