import { useEffect, useState } from 'react'
import BankActionModal from './BankActionModal'
import InventorySlot from './InventorySlot'
import { Button } from './ui/Button'
import { useDailyQuestsModalStore } from '../game/dailyQuests/useDailyQuestsModalStore'
import { useDailyQuestsStore, type DailyQuest } from '../game/dailyQuests/useDailyQuestsStore'
import { questTarget, eligibleQualityOrderItems } from '../game/dailyQuests/dailyQuestHelpers'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useInventoryStore } from '../game/items/useInventoryStore'
import { useItemTemplatesStore } from '../game/items/useItemTemplatesStore'
import { useEquipmentStore } from '../game/items/useEquipmentStore'
import { formatItemDisplayName, getQualityColor, getGearIconSrc } from '../game/items/equipmentBonus'
import { ENEMY_TYPES } from '../game/zones/zoneData'

const QUEST_LABELS: Record<DailyQuest['type'], string> = {
  quality_order: 'Fulfil an Order',
  kill_count: 'Bounty Hunt',
  world_boss_attacks: 'World Boss Duty',
  gold_donation: 'Gold Donation',
  socket_obtain: 'Socket Prospecting',
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

// Grid of the character's own eligible Inventory tiles — the "Select" step
// (requested by the user: "select should bring up your inventory where you
// can select the gear you want to submit"), reusing the same InventorySlot
// tile every other item grid in the game uses rather than a plain list.
// Picking a tile doesn't submit anything by itself — it just reports the
// choice back up to QuestCard, which is the one that actually calls claim().
function QualityOrderPicker({
  quest,
  onSelect,
  onCancel,
}: {
  quest: DailyQuest
  onSelect: (itemId: string) => void
  onCancel: () => void
}) {
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const isEquipped = useEquipmentStore((state) => state.isEquipped)
  const slotType = String(quest.target.slot_type ?? '')
  const eligible = eligibleQualityOrderItems(quest, items, templates, isEquipped)

  return (
    <div className="mt-2">
      {eligible.length === 0 ? (
        <p className="text-xs text-slate-500">You don't have a qualifying {slotType} to turn in yet.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {eligible.map((item) => {
            const template = templates.find((entry) => entry.id === item.template_id)
            const name = template ? formatItemDisplayName(template.name, item.quality_tier, item.composition_level) : 'Unknown item'
            return (
              <InventorySlot
                key={item.id}
                slotId={`quality-order-pick-${item.id}`}
                filled
                sizeClassName="aspect-square w-full"
                iconSrc={getGearIconSrc(template?.name, item.quality_tier)}
                icon="❔"
                qualityColor={getQualityColor(item.quality_tier)}
                label={name}
                onClick={() => onSelect(item.id)}
              />
            )
          })}
        </div>
      )}
      <button type="button" onClick={onCancel} className="mt-2 text-xs text-slate-500 hover:text-slate-300">
        Cancel
      </button>
    </div>
  )
}

function QuestCard({ quest, characterId, atMaxLevel }: { quest: DailyQuest; characterId: string; atMaxLevel: boolean }) {
  const claim = useDailyQuestsStore((state) => state.claim)
  const busy = useDailyQuestsStore((state) => state.busy)
  const items = useInventoryStore((state) => state.items)
  const templates = useItemTemplatesStore((state) => state.templates)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const target = questTarget(quest)
  const isQualityOrder = quest.type === 'quality_order'
  const complete = isQualityOrder ? selectedItemId !== null : quest.progress >= target

  const selectedItem = selectedItemId ? items.find((item) => item.id === selectedItemId) : undefined
  const selectedTemplate = selectedItem ? templates.find((entry) => entry.id === selectedItem.template_id) : undefined
  const selectedName = selectedItem && selectedTemplate ? formatItemDisplayName(selectedTemplate.name, selectedItem.quality_tier, selectedItem.composition_level) : null

  const handleClaim = async () => {
    setError(null)
    const result = await claim(characterId, quest.slot, selectedItemId ?? undefined)
    if (!result.ok) {
      setError(result.error ?? 'rpc_failed')
      // The selected item may have stopped qualifying since it was picked
      // (equipped, moved to Bank, sold, etc.) -- send the player back to the
      // picker to choose again rather than leaving a dead Claim button.
      if (isQualityOrder) {
        setSelectedItemId(null)
      }
    }
  }

  return (
    <div className="ascension-chip-frame">
      <div className="ascension-chip-inner p-3">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm font-bold uppercase tracking-[0.08em] text-slate-100">{QUEST_LABELS[quest.type]}</h3>
          {quest.claimed && <span className="text-xs text-emerald-400">Claimed</span>}
        </div>
        <p className="mt-1 text-xs text-slate-400">{describeQuest(quest, atMaxLevel)}</p>
        <p className="mt-1 text-xs text-slate-500">Reward: {rewardLabel(quest, atMaxLevel)}</p>

        {!isQualityOrder && target > 1 && !quest.claimed && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-slate-400 to-slate-200"
              style={{ width: `${Math.min(100, Math.round((quest.progress / target) * 100))}%` }}
            />
          </div>
        )}

        {quest.claimed ? null : isQualityOrder && pickerOpen ? (
          <QualityOrderPicker
            quest={quest}
            onSelect={(itemId) => {
              setSelectedItemId(itemId)
              setPickerOpen(false)
            }}
            onCancel={() => setPickerOpen(false)}
          />
        ) : isQualityOrder && selectedItemId ? (
          <>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-xs hover:border-slate-500"
            >
              <span className="truncate text-slate-200">{selectedName ?? 'Selected item'}</span>
              <span className="shrink-0 text-slate-500">Change</span>
            </button>
            <Button variant="primary" disabled={busy} onClick={() => void handleClaim()} className="mt-2 w-full py-1.5 text-xs">
              Claim
            </Button>
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          </>
        ) : isQualityOrder ? (
          <Button variant="secondary" onClick={() => setPickerOpen(true)} className="mt-3 w-full py-1.5 text-xs">
            Select Item
          </Button>
        ) : (
          <>
            <Button variant="primary" disabled={!complete || busy} onClick={() => void handleClaim()} className="mt-3 w-full py-1.5 text-xs">
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
  const ensure = useDailyQuestsStore((state) => state.ensure)
  const characterId = useActiveCharacterStore((state) => state.characterId)
  const level = useProgressionStore((state) => state.level)

  // Refetch on open, not just on mount/the 5-minute interval — otherwise
  // progress made just before opening (e.g. donating gold, then checking
  // the popup) shows stale until the next periodic ensure() call.
  useEffect(() => {
    if (open && characterId) {
      void ensure(characterId)
    }
  }, [open, characterId, ensure])

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
