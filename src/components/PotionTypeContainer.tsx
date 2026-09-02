import { CONSUMABLE_COLOR } from '../game/items/forgeCosts'
import { findBestPotionStack, totalPotionCount } from '../game/items/potionSelectors'
import { POTION_TYPES, type PotionTypeId } from '../game/items/potionTypes'
import type { PotionStack } from '../game/items/usePotionStore'
import { useCombatStore } from '../game/combat/useCombatStore'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useVipAutomationStore } from '../game/vip/useVipAutomationStore'
import { useRequiresVipToastStore } from '../game/vip/useRequiresVipToastStore'

// Hunting tab's HP/Mana potion quick-use widget (2026-09-02) — replaces the
// old "2 separate rows" (a full-width HP row, then a full-width Mana row
// shown only while activeSkill) on CombatPage.tsx with one compact row of 2
// fixed containers, one per kind. Shows the best owned tier's icon and the
// total count across every tier of that kind (not just the best tier's own
// stack count), click-to-use the best tier directly, plus a VIP-gated Auto
// button (PotionAutoUseEngine.tsx does the actual auto-drinking once
// enabled).
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

  const useTitle = !bestStack ? `No ${label} potions — visit the Shop` : isFull ? `${label} already full` : `Use ${type?.displayName}`

  return (
    <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-xs">
      <button
        type="button"
        disabled={!canUse}
        title={useTitle}
        onClick={() => bestStack && onUse(bestStack.id)}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 p-1 text-base transition ${
          canUse ? 'hover:brightness-110' : 'cursor-not-allowed opacity-50'
        }`}
        style={{ borderColor: CONSUMABLE_COLOR, backgroundColor: `${CONSUMABLE_COLOR}22` }}
      >
        {type?.iconSrc ? (
          <img src={type.iconSrc} alt="" className="h-full w-full object-contain" />
        ) : kind === 'hp' ? (
          '🧪'
        ) : (
          '💧'
        )}
      </button>

      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate font-medium text-slate-200">{label} Potions</p>
        <p className="text-slate-400">{total}</p>
      </div>

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
        className={`shrink-0 rounded-lg border px-3 py-1.5 font-medium transition ${
          autoOn && isVipActive
            ? 'border-purple-500 bg-purple-600 text-white hover:bg-purple-500'
            : 'border-purple-600 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20'
        }`}
      >
        Auto
      </button>
    </div>
  )
}
