import { useState } from 'react'
import BankActionModal from './BankActionModal'
import { Button } from './ui/Button'
import { useDailyQuestsModalStore } from '../game/dailyQuests/useDailyQuestsModalStore'
import { useDailyQuestsStore, type DailyQuest } from '../game/dailyQuests/useDailyQuestsStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { formatItemDisplayName, getQualityColor } from '../game/items/equipmentBonus'
import { ENEMY_TYPES } from '../game/zones/zoneData'

const QUEST_LABELS: Record<DailyQuest['type'], string> = {
  quality_order: 'Fulfil an Order',
  kill_count: 'Bounty Hunt',
  world_boss_attacks: 'World Boss Duty',
  gold_donation: 'Gold Donation',
  socket_obtain: 'Socket Prospecting',
}

function questTarget(quest: DailyQuest): number {
  if (quest.type === 'kill_count') return Number(quest.target.required_kills ?? 0)
  if (quest.type === 'world_boss_attacks') return Number(quest.target.required_attacks ?? 0)
  return 1
}

function isComplete(quest: DailyQuest): boolean {
  if (quest.type === 'quality_order') return true // checked live against inventory at claim time, not tracked as progress
  return quest.progress >= questTarget(quest)
}

function describeQuest(quest: DailyQuest, atMaxLevel: boolean): string {
  switch (quest.type) {
    case 'quality_order': {
      const slot = String(quest.target.slot_type ?? 'item')
      return `Turn in a Tempered-or-better ${slot} from your Inventory. Reward scales with quality submitted${atMaxLevel ? ' (Lottery Tickets at max level)' : ' (Experience Orb-equivalent EXP)'}.`
    }
    case 'kill_count': {
      const monsterId = String(quest.target.monster_id ?? '')
      const monsterName = ENEMY_TYPES[monsterId as keyof typeof ENEMY_TYPES]?.displayName ?? 'target monster'
      return `Kill ${questTarget(quest)} ${monsterName} (${quest.progress}/${questTarget(quest)}).`
    }
    case 'world_boss_attacks':
      return `Attack a World Boss ${questTarget(quest)} times today (${quest.progress}/${questTarget(quest)}).`
    case 'gold_donation':
      return 'Make a donation to the Gold Donation event.'
    case 'socket_obtain':
      return 'Land a new socket on any item via the Forge.'
    default:
      return ''
  }
}

function rewardLabel(quest: DailyQuest, atMaxLevel: boolean): string {
  switch (quest.type) {
    case 'quality_order':
      return atMaxLevel ? '1-5 Lottery Tickets' : '1-5 Experience Orbs worth of EXP'
    case 'kill_count':
      return '1 Experience Orb worth of EXP + 1 Comet Scroll'
    case 'world_boss_attacks':
    case 'gold_donation':
      return 'A random Money Bag'
    case 'socket_obtain':
      return '1 Fallen Star Scroll'
    default:
      return ''
  }
}

function QualityOrderPicker({ quest, characterId }: { quest: DailyQuest; characterId: string }) {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const isEquipped = useEquipmentStore((state) => state.isEquipped)
  const claim = useDailyQuestsStore((state) => state.claim)
  const busy = useDailyQuestsStore((state) => state.busy)
  const [error, setError] = useState<string | null>(null)

  const slotType = String(quest.target.slot_type ?? '')
  const eligible = items.filter((item) => {
    if (item.location !== 'inventory' || isEquipped(item.id)) return false
    if (!['tempered', 'infused', 'radiant', 'ascended'].includes(item.quality_tier)) return false
    const template = templates.find((entry) => entry.id === item.template_id)
    return template?.slot_type === slotType
  })

  if (eligible.length === 0) {
    return <p className="mt-2 text-xs text-slate-500">You don't have a qualifying {slotType} to turn in yet.</p>
  }

  return (
    <div className="mt-2 space-y-1.5">
      {eligible.map((item) => {
        const template = templates.find((entry) => entry.id === item.template_id)
        return (
          <div key={item.id} className="ascension-chip-frame is-interactive">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setError(null)
                const result = await claim(characterId, quest.slot, item.id)
                if (!result.ok) setError(result.error ?? 'rpc_failed')
              }}
              className="ascension-chip-inner flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-xs disabled:opacity-50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: getQualityColor(item.quality_tier) }} />
                <span className="truncate text-slate-200">
                  {template ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level) : 'Unknown item'}
                </span>
              </span>
              <span className="shrink-0 text-slate-300">Turn in</span>
            </button>
          </div>
        )
      })}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

function QuestCard({ quest, characterId, atMaxLevel }: { quest: DailyQuest; characterId: string; atMaxLevel: boolean }) {
  const claim = useDailyQuestsStore((state) => state.claim)
  const busy = useDailyQuestsStore((state) => state.busy)
  const [error, setError] = useState<string | null>(null)
  const complete = isComplete(quest)
  const target = questTarget(quest)

  return (
    <div className="ascension-chip-frame">
      <div className="ascension-chip-inner p-3">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm font-bold uppercase tracking-[0.08em] text-slate-100">{QUEST_LABELS[quest.type]}</h3>
          {quest.claimed && <span className="text-xs text-emerald-400">Claimed</span>}
        </div>
        <p className="mt-1 text-xs text-slate-400">{describeQuest(quest, atMaxLevel)}</p>
        <p className="mt-1 text-xs text-slate-500">Reward: {rewardLabel(quest, atMaxLevel)}</p>

        {quest.type !== 'quality_order' && target > 1 && !quest.claimed && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-slate-400 to-slate-200"
              style={{ width: `${Math.min(100, Math.round((quest.progress / target) * 100))}%` }}
            />
          </div>
        )}

        {quest.claimed ? null : quest.type === 'quality_order' ? (
          <QualityOrderPicker quest={quest} characterId={characterId} />
        ) : (
          <>
            <Button
              variant="primary"
              disabled={!complete || busy}
              onClick={async () => {
                setError(null)
                const result = await claim(characterId, quest.slot)
                if (!result.ok) setError(result.error ?? 'rpc_failed')
              }}
              className="mt-3 w-full py-1.5 text-xs"
            >
              {complete ? 'Claim' : 'Not complete yet'}
            </Button>
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}

export default function DailyQuestsModal() {
  const open = useDailyQuestsModalStore((state) => state.open)
  const closeModal = useDailyQuestsModalStore((state) => state.closeModal)
  const quests = useDailyQuestsStore((state) => state.quests)
  const characterId = useActiveCharacterStore((state) => state.characterId)
  const level = useProgressionStore((state) => state.level)

  if (!open || !characterId) {
    return null
  }

  const atMaxLevel = level >= 130
  const sortedQuests = [...quests].sort((a, b) => a.slot - b.slot)

  return (
    <BankActionModal title="Daily Quests" subtitle="Resets every day at midnight UTC" onClose={closeModal} widthClassName="max-w-md">
      <div className="max-h-[65vh] space-y-3 overflow-y-auto">
        {sortedQuests.map((quest) => (
          <QuestCard key={quest.slot} quest={quest} characterId={characterId} atMaxLevel={atMaxLevel} />
        ))}
      </div>
    </BankActionModal>
  )
}
