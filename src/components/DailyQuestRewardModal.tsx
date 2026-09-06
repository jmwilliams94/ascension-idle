import InventorySlot from './InventorySlot'
import BankActionModal from './BankActionModal'
import { Button } from './ui/Button'
import { useDailyQuestRewardStore } from '../game/dailyQuests/useDailyQuestRewardStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { getGearIconSrc, getQualityColor, formatItemDisplayName } from '../game/items/equipmentBonus'
import { EXPERIENCE_ORB_ICON_SRC, COMET_SCROLL_ICON_SRC, FALLEN_STAR_SCROLL_ICON_SRC, CONSUMABLE_COLOR } from '../game/items/forgeCosts'

const LOTTERY_TICKET_ICON_SRC = `${import.meta.env.BASE_URL}item-icons/lottery-ticket.webp`
const TILE_SIZE_CLASS = 'h-14 w-14'

interface RewardTile {
  key: string
  iconSrc?: string
  icon?: string
  label: string
  qualityColor?: string
}

// "What did you just win" reveal for claiming a Daily Quest (requested by
// the user, 2026-09-06 — "I don't want any of the quests to silently reward
// and appear in the inventory"). Shows the actual item art (N Experience
// Orb tiles for an EXP reward, the real Money Bag that was granted, etc.)
// rather than just a text summary, mirroring the shared "an item tile is the
// unit" convention every other reward surface in the game uses.
export default function DailyQuestRewardModal() {
  const reward = useDailyQuestRewardStore((state) => state.reward)
  const dismiss = useDailyQuestRewardStore((state) => state.dismiss)
  const templates = useItemTemplatesStore((state) => state.templates)

  if (!reward) {
    return null
  }

  let tiles: RewardTile[] = []
  let summary = ''

  if (reward.kind === 'exp') {
    const ballCount = reward.ball_count ?? 1
    tiles = Array.from({ length: ballCount }, (_, index) => ({
      key: `orb-${index}`,
      iconSrc: EXPERIENCE_ORB_ICON_SRC,
      label: 'Experience Orb',
      qualityColor: CONSUMABLE_COLOR,
    }))
    summary = `${ballCount} Experience Orb${ballCount === 1 ? '' : 's'} worth of EXP (+${reward.amount.toLocaleString()} EXP)`
  } else if (reward.kind === 'exp_and_comet_scroll') {
    tiles = [
      { key: 'orb', iconSrc: EXPERIENCE_ORB_ICON_SRC, label: 'Experience Orb', qualityColor: CONSUMABLE_COLOR },
      { key: 'scroll', iconSrc: COMET_SCROLL_ICON_SRC, label: 'Comet Scroll', qualityColor: CONSUMABLE_COLOR },
    ]
    summary = `1 Experience Orb worth of EXP (+${reward.exp_amount.toLocaleString()} EXP) + 1 Comet Scroll`
  } else if (reward.kind === 'lottery_ticket') {
    tiles = Array.from({ length: reward.amount }, (_, index) => ({
      key: `ticket-${index}`,
      iconSrc: LOTTERY_TICKET_ICON_SRC,
      label: 'Lottery Ticket',
      qualityColor: CONSUMABLE_COLOR,
    }))
    summary = `${reward.amount} Lottery Ticket${reward.amount === 1 ? '' : 's'}`
  } else if (reward.kind === 'fallen_star_scroll') {
    tiles = [{ key: 'scroll', iconSrc: FALLEN_STAR_SCROLL_ICON_SRC, label: 'Fallen Star Scroll', qualityColor: CONSUMABLE_COLOR }]
    summary = '1 Fallen Star Scroll'
  } else if (reward.kind === 'money_bag') {
    const template = templates.find((entry) => entry.id === reward.item.template_id)
    const name = template
      ? formatItemDisplayName(template.name, reward.item.quality_tier, reward.item.composition_level)
      : 'Money Bag'
    tiles = [
      {
        key: 'bag',
        iconSrc: getGearIconSrc(template?.name, reward.item.quality_tier),
        icon: '💰',
        label: name,
        qualityColor: getQualityColor(reward.item.quality_tier),
      },
    ]
    summary = name
  }

  return (
    <BankActionModal title="Quest Complete!" onClose={dismiss} widthClassName="max-w-sm">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {tiles.map((tile) => (
          <InventorySlot
            key={tile.key}
            slotId={`daily-quest-reward-${tile.key}`}
            filled
            sizeClassName={TILE_SIZE_CLASS}
            icon={tile.icon}
            iconSrc={tile.iconSrc}
            qualityColor={tile.qualityColor}
            label={tile.label}
          />
        ))}
      </div>
      <p className="mt-4 text-center text-sm text-slate-300">{summary}</p>
      <Button variant="primary" onClick={dismiss} className="mt-4 w-full">
        Nice!
      </Button>
    </BankActionModal>
  )
}
