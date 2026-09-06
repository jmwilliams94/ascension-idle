import { useDailyQuestsStore } from '../game/dailyQuests/useDailyQuestsStore'
import { useDailyQuestsModalStore } from '../game/dailyQuests/useDailyQuestsModalStore'

// Fixed floating button, bottom-right corner — same visual family/positioning
// pattern as UnclaimedLootBadge.tsx (which sits bottom-left), just mirrored to
// the opposite corner so the two don't collide. Renders nothing until the
// first `ensure` call resolves (mirrors UnclaimedLootBadge's "nothing to show
// yet" early return).
export default function DailyQuestBadge() {
  const quests = useDailyQuestsStore((state) => state.quests)
  const openModal = useDailyQuestsModalStore((state) => state.openModal)

  if (quests.length === 0) {
    return null
  }

  const unclaimedCount = quests.filter((quest) => !quest.claimed).length

  if (unclaimedCount === 0) {
    return null
  }

  return (
    <button
      type="button"
      onClick={openModal}
      aria-label={`${unclaimedCount} daily quest${unclaimedCount === 1 ? '' : 's'} unclaimed — tap to review`}
      className="fixed bottom-20 right-3 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 bg-slate-950/90 text-2xl leading-none shadow-lg shadow-black/50 hover:bg-slate-900 lg:bottom-4 backdrop-blur"
      // translateZ(0) — same iOS PWA compositing-layer workaround as
      // UnclaimedLootBadge, own layer rather than relying on a parent's.
      style={{ transform: 'translateZ(0)' }}
    >
      <span className="leading-none">❗</span>
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-900 bg-slate-300 px-1 text-[10px] font-bold text-slate-950">
        {unclaimedCount}
      </span>
    </button>
  )
}
