import InventorySlot, { SLOT_SIZE_CLASS } from './InventorySlot'
import { CONSUMABLE_COLOR } from '../game/items/forgeCosts'
import { findBestPotionStack, totalPotionCount } from '../game/items/potionSelectors'
import { POTION_TYPES, type PotionTypeId } from '../game/items/potionTypes'
import type { ItemTooltipData } from '../game/items/itemTooltip'
import type { PotionStack } from '../game/items/usePotionStore'
import { useCombatStore } from '../game/combat/useCombatStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useVipAutomationStore } from '../game/vip/useVipAutomationStore'
import { useRequiresVipToastStore } from '../game/vip/useRequiresVipToastStore'

// Hunting tab's HP/Mana potion quick-use widget (2026-09-02) — replaces the
// old "2 separate rows" (a full-width HP row, then a full-width Mana row
// shown only while activeSkill) on CombatPage.tsx with 2 fixed containers
// side by side (CombatPage.tsx lays them out in a grid-cols-2 row, not
// flex-wrap, so they never stack even on narrow mobile widths).
//
// Reuses InventorySlot for the icon itself (2026-09-02, v1.127.2 — an
// earlier pass hand-rolled a plain <button> here, which lost the standard
// item-quality-frame border every other gear/item tile has and rendered at
// a non-standard size) so this reads as the same "unit" as every other
// item tile in the game (Inventory, Forge, Bank, Loot Holding) — same
// SLOT_SIZE_CLASS size, same gradient-border frame (qualityColor =
// CONSUMABLE_COLOR, matching the old per-tier Inventory tiles' own color),
// and the total count across every tier of that kind (not just the best
// tier's own stack count) rendered as InventorySlot's own bottom-right
// `badge`, exactly like every stack count elsewhere in the game.
//
// Isolated in its own component (not inlined in CombatPage.tsx) so only
// this subscribes to the live HP/MP that ticks every 100ms while combat
// runs — CombatPage.tsx already isolates its own currentPlayerHp/MP reads
// for the same reason (see its own HpBar usage).
export default function PotionTypeContainer({
  kind,
  order,
  stacks,
  onUse,
}: {
  kind: 'hp' | 'mp'
  order: readonly PotionTypeId[]
  stacks: PotionStack[]
  onUse: (stackId: string) => void
}) {
  const currentPlayerHp = useCombatStore((state) => state.currentPlayerHp)
  const maxPlayerHp = useCombatStore((state) => state.maxPlayerHp)
  const currentPlayerMp = useCombatStore((state) => state.currentPlayerMp)
  const maxPlayerMp = useCombatStore((state) => state.maxPlayerMp)
  const vipExpiresAt = useCharacterStore((state) => state.vipExpiresAt)
  const autoUsePotions = useVipAutomationStore((state) => state.settings.autoUsePotions)
  const updateVipAutomationSettings = useVipAutomationStore((state) => state.updateSettings)
  const showRequiresVipToast = useRequiresVipToastStore((state) => state.show)

  const isVipActive = Boolean(vipExpiresAt && new Date(vipExpiresAt).getTime() > Date.now())
  const bestStack = findBestPotionStack(stacks, order)
  const total = totalPotionCount(stacks, order)
  const type = bestStack ? POTION_TYPES[bestStack.potionType] : null
  const isFull = kind === 'hp' ? maxPlayerHp > 0 && currentPlayerHp >= maxPlayerHp : maxPlayerMp > 0 && currentPlayerMp >= maxPlayerMp
  const canUse = Boolean(bestStack) && !isFull
  const autoOn = autoUsePotions[kind]
  const label = kind === 'hp' ? 'HP' : 'Mana'
  // "Health"/"Mana" — the heading label above the Auto button. Kept distinct
  // from `label` above, which stays the "HP" abbreviation used everywhere
  // else (tooltips, the "No HP potions" message) — this one's spelled out.
  const headingLabel = kind === 'hp' ? 'Health' : 'Mana'
  const fallbackIcon = kind === 'hp' ? '🧪' : '💧'

  const tooltip: ItemTooltipData | undefined = type
    ? {
        title: type.displayName,
        icon: fallbackIcon,
        iconSrc: type.iconSrc,
        iconColor: CONSUMABLE_COLOR,
        lines: [kind === 'hp' ? 'HP Potion' : 'Mana Potion', `${total} owned`],
        stats: [type.description],
      }
    : undefined

  return (
    <div className="ascension-chip-frame">
      <div className="ascension-chip-inner flex items-center gap-2 p-2">
        <InventorySlot
          slotId={`potion-quick-use-${kind}`}
          filled
          sizeClassName={SLOT_SIZE_CLASS}
          icon={fallbackIcon}
          iconSrc={type?.iconSrc}
          qualityColor={CONSUMABLE_COLOR}
          badge={bestStack ? String(total) : undefined}
          label={!bestStack ? `No ${label} potions — visit the Shop` : isFull ? `${label} already full` : `Use ${type?.displayName}`}
          tooltip={tooltip}
          dimmed={!canUse}
          onClick={() => bestStack && canUse && onUse(bestStack.id)}
        />

        <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="text-heading-label">{headingLabel}</span>
          <button
            type="button"
            aria-pressed={autoOn && isVipActive}
            title={isVipActive ? `Auto-use ${label} potions below 30%` : 'Requires VIP'}
            onClick={() => {
              if (!isVipActive) {
                showRequiresVipToast('Requires VIP')
                return
              }
              void updateVipAutomationSettings({ autoUsePotions: { ...autoUsePotions, [kind]: !autoOn } })
            }}
            className={`w-full rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              autoOn && isVipActive
                ? 'border-purple-500 bg-purple-600 text-white hover:bg-purple-500'
                : 'border-purple-600 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20'
            }`}
          >
            Auto
          </button>
        </div>
      </div>
    </div>
  )
}
