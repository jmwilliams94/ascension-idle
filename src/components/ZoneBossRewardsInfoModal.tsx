import BankActionModal from './BankActionModal'
import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { mailCurrencyLabel, mailCurrencyVisual, mailCurrencyTooltip } from '../game/marketplace/listableCurrency'
import type { MailCurrencyType } from '../game/marketplace/useMailStore'

// Opened via the ❓ IconButton next to the trophy leaderboard button — see
// CLAUDE.server-events.md's Rewards bullet for the full mechanic writeup
// this explains in player-facing terms. Shows this specific boss's actual
// reward_pool (fetched fresh per spawn, see zone_boss_reward_pool_for_level)
// as real InventorySlot tiles rather than just describing it in prose, so a
// player can see exactly what's on the table right now.
export default function ZoneBossRewardsInfoModal({
  bossName,
  rewardPool,
  onClose,
}: {
  bossName: string
  rewardPool: Record<string, number>
  onClose: () => void
}) {
  const poolEntries = Object.entries(rewardPool).filter(([, amount]) => amount > 0) as [MailCurrencyType, number][]

  return (
    <BankActionModal title="How Rewards Work" subtitle={bossName} onClose={onClose}>
      <div className="space-y-4">
        {poolEntries.length > 0 && (
          <div>
            <p className="text-center text-xs text-slate-300">This fight's full reward pool</p>
            <div className="mt-2 flex flex-wrap justify-center gap-3">
              {poolEntries.map(([currencyType, amount]) => {
                const visual = mailCurrencyVisual(currencyType)
                return (
                  <InventorySlot
                    key={currencyType}
                    slotId={currencyType}
                    filled
                    sizeClassName={SLOT_SIZE_CLASS}
                    icon={visual.icon}
                    iconSrc={visual.iconSrc}
                    qualityColor={visual.qualityColor}
                    label={mailCurrencyLabel(currencyType)}
                    tooltip={mailCurrencyTooltip(currencyType, amount)}
                    badge={String(amount)}
                  />
                )
              })}
            </div>
          </div>
        )}

        <ul className="list-disc space-y-2 pl-4 text-xs text-slate-400">
          <li>You get a share of each pool above equal to the % of the boss's HP you personally damaged — deal 20% of its HP, get 20% of every pool.</li>
          <li>No character can ever deal more than 34% of a boss's HP, so killing any boss takes damage from at least 3 different characters.</li>
          <li>Everyone who attacks at least once also gets 1 Lottery Ticket, on top of any pool share.</li>
          <li>If a boss's window ends without dying, only the HP that was actually damaged pays out — the rest of the pool goes unclaimed, not to whoever showed up.</li>
          <li>Tougher bosses in later zones have bigger reward pools.</li>
        </ul>
      </div>
    </BankActionModal>
  )
}
