import { useDailyQuestsStore } from '../game/dailyQuests/useDailyQuestsStore'
import { useDailyQuestsModalStore } from '../game/dailyQuests/useDailyQuestsModalStore'

// Fixed floating button, bottom-right corner — same visual family/positioning
// pattern as UnclaimedLootBadge.tsx (which sits bottom-left), just mirrored to
// the opposite corner so the two don't collide. Renders nothing until the
// first `ensure` call resolves (mirrors UnclaimedLootBadge's "nothing to show
// yet" early return).
//
// Deliberately NOT backdrop-blur + its own translateZ(0) layer, unlike
// UnclaimedLootBadge (see gotcha_backdrop_blur_mobile_nav_drift memory — that
// combination on a fixed mobile element has repeatedly caused
// MobileBottomNav's own position:fixed to detach/drift on scroll on some
// mobile browsers). UnclaimedLootBadge is usually absent (renders null at
// count 0), so it rarely actually competes with the nav for a GPU layer —
// this badge is present almost any time a character has an unclaimed quest,
// i.e. nearly always, so it hits that interaction far more often. Reported
// 2026-09-06: nav bar became unstuck and drifted upward on scroll once this
// badge shipped, plus the badge itself appeared clipped by the nav (a
// symptom of the nav drifting into the badge's space, not a bad offset).
// Solid bg-slate-950 (not /90 translucent) compensates for the lost blur so
// it doesn't read as flat/washed-out without it.
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
      className="fixed bottom-24 right-3 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 bg-slate-950 text-2xl leading-none shadow-lg shadow-black/50 hover:bg-slate-900 lg:bottom-4"
    >
      <span className="leading-none">❗</span>
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-slate-900 bg-slate-300 px-1 text-[10px] font-bold text-slate-950">
        {unclaimedCount}
      </span>
    </button>
  )
}
