// Lucky — placeholder page (2026-08-03). The real design (confirmed with the
// user, not yet built): a free ticket every 6 hours plus paid extra attempts
// (cost in Ascension Points, not yet decided), a 9-card pick-one-reveal-all
// mystery box, resolved through a single atomic server-side RPC so no reward
// is ever transmitted to the client before the pick is already locked in and
// granted — nothing to read out of the DOM ahead of choosing. Reward pool
// (money bags in 10 increasing tiers, hyper-rare Radiant/Ascended gear,
// bonus consumables, Gems, Meteor/DragonBall/Scroll units) is still being
// decided — several of those (which specific hyper-rare items, the new
// drop-rate-buff consumable type, Gems as real inventory items at all) don't
// exist as content/systems yet. Don't invent any of that here — this stub
// only exists so the nav has somewhere to point.
export default function LuckyPanel() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center">
      <p className="text-sm font-medium text-slate-300">Lucky</p>
      <p className="mt-1 text-xs text-slate-500">
        A ticket-draw feature is coming here — pick one of 9 cards for a shot at rare rewards. Not built yet.
      </p>
    </div>
  )
}
